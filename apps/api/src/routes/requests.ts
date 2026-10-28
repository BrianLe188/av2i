import { evaluate, resource, type Statement } from "@av2i/authz";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "kysely";
import { audit } from "../audit.ts";
import { sessionOnly, type Ctx } from "../context.ts";
import { HttpError, notFound } from "../errors.ts";
import { projectAccess } from "../project-access.ts";
import { addEvent, LIVE, requestCan, type RequestRow } from "../requests.ts";
import { applyState } from "../runs/apply.ts";
import type { PlanSummary } from "../runs/plan.ts";

const idParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const MAX_COMMENT = 5000;
const STALE = new Set(["plan_expired", "design_changed", "variables_changed", "connection_changed", "state_changed", "already_applied"]);

/** Requests: asking for an apply to be approved, with a timeline and a talk like a pull request (DD-027). */
export function requestRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const { actor, accessOf, authorize } = projectAccess(ctx);

  const requestOf = async (id: string): Promise<RequestRow> => {
    const r = await db.selectFrom("requests").selectAll().where("id", "=", id).executeTakeFirst();
    if (!r) throw notFound("No such request.");
    return r as RequestRow;
  };
  const projectOf = async (id: string) => {
    const p = await db.selectFrom("projects").select(["id", "owner_id", "name", "design", "connection_id"]).where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
    if (!p) throw notFound("No such request.");
    return p;
  };
  /** The request, its project and what the person may do: 404 for someone who may not read the project. */
  const open = async (req: FastifyRequest, id: string) => {
    const r = await requestOf(id);
    const project = await projectOf(r.project_id);
    const statements = await authorize(req, project, "project:Read");
    return { r, project, statements };
  };
  const planOf = async (planRunId: string | null) => {
    if (!planRunId) return null;
    return (await db.selectFrom("runs").select(["id", "status", "summary", "created_by", "finished_at", "files_hash", "variables_hash", "connection_id", "state_serial", sql<boolean>`plan_data is not null`.as("has_plan")]).where("id", "=", planRunId).executeTakeFirst()) ?? null;
  };
  const destructiveOf = (plan: { summary: unknown } | null) => !!(plan?.summary as PlanSummary | null)?.destructive;
  const sizeOf = (plan: { summary: unknown } | null) => {
    const s = plan?.summary as PlanSummary | null;
    return s ? { add: s.add, change: s.change, destroy: s.destroy, replace: s.replace, destructive: s.destructive } : null;
  };

  const row = (r: RequestRow, projectName: string, size: ReturnType<typeof sizeOf>) => ({
    id: r.id, number: r.number, kind: r.kind, status: r.status, closeReason: r.close_reason, projectId: r.project_id, projectName, requester: r.requester,
    decidedBy: r.decided_by, createdAt: r.created_at, updatedAt: r.updated_at, size,
  });

  /** Requests of the projects the person may read, newest activity first; `awaiting` is what they may decide. */
  const visible = async (req: FastifyRequest, scope: "awaiting" | "mine" | "project", projectId?: string) => {
    const me = actor(req);
    let q = db.selectFrom("requests as q").innerJoin("projects as p", "p.id", "q.project_id").leftJoin("runs as r", "r.id", "q.plan_run_id")
      .select(["q.id", "q.project_id", "q.number", "q.kind", "q.plan_run_id", "q.status", "q.close_reason", "q.requester_id", "q.requester", "q.decided_by_id", "q.decided_by", "q.decided_at", "q.created_at", "q.updated_at", "p.name as project_name", "p.owner_id", "r.summary"])
      .where("p.deleted_at", "is", null).orderBy("q.updated_at", "desc").limit(300);
    if (scope === "awaiting") q = q.where("q.status", "=", "waiting").where((eb) => eb.or([eb("q.requester_id", "is", null), eb("q.requester_id", "!=", me.userId)]));
    else if (scope === "mine") q = q.where("q.requester_id", "=", me.userId);
    else q = q.where("q.project_id", "=", projectId!);
    const rows = await q.execute();
    const access = new Map<string, Statement[]>();
    const out = [];
    for (const r of rows) {
      if (!access.has(r.project_id)) access.set(r.project_id, await accessOf(req, { id: r.project_id, owner_id: r.owner_id }));
      const st = access.get(r.project_id)!;
      const res = resource.project(r.project_id);
      if (!evaluate(st, { action: "project:Read", resource: res }).allowed) continue;
      if (scope === "awaiting" && !evaluate(st, { action: "run:Approve", resource: res }).allowed) continue;
      out.push(row(r as unknown as RequestRow, r.project_name, sizeOf(r)));
    }
    return out;
  };

  app.get("/api/requests/summary", async (req) => {
    const awaiting = (await visible(req, "awaiting")).length;
    const mine = (await visible(req, "mine")).filter((r) => r.status === "waiting" || r.status === "approved").length;
    return { awaiting, mine };
  });

  app.get("/api/requests", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: { scope: { type: "string", enum: ["awaiting", "mine", "project"] }, projectId: { type: "string", format: "uuid" } } } },
  }, async (req) => {
    const { scope = "awaiting", projectId } = req.query as { scope?: "awaiting" | "mine" | "project"; projectId?: string };
    if (scope === "project" && !projectId) throw new HttpError(400, "invalid_request", "projectId is needed for the project scope.");
    return { requests: await visible(req, scope, projectId) };
  });

  app.get("/api/requests/:id", { schema: { params: idParams } }, async (req) => {
    const { r, project, statements } = await open(req, (req.params as { id: string }).id);
    const me = actor(req);
    const plan = await planOf(r.plan_run_id);
    const destructive = destructiveOf(plan);
    let blockers: { code: string }[] = [];
    let expiresAt: Date | null = null;
    if (plan && (r.status === "waiting" || r.status === "approved")) {
      const st = await applyState(db, config, { id: plan.id, kind: "plan", status: plan.status, hasPlan: !!plan.has_plan, finished_at: plan.finished_at, files_hash: plan.files_hash, variables_hash: plan.variables_hash, connection_id: plan.connection_id, state_serial: plan.state_serial, created_by: plan.created_by, destructive }, project);
      blockers = st.blockers;
      expiresAt = st.expiresAt;
    }
    const stale = blockers.filter((b) => STALE.has(b.code)).map((b) => b.code);
    const events = await db.selectFrom("request_events").selectAll().where("request_id", "=", r.id).orderBy("id").execute();
    const can = requestCan(statements, project.id, me.userId, r, destructive);
    // a newer plan of the project that the requester could put into this request
    const newer = can.replan && plan?.finished_at
      ? await db.selectFrom("runs as p").select(["p.id", "p.finished_at"]).where("p.project_id", "=", project.id).where("p.kind", "=", "plan").where("p.status", "=", "succeeded").where("p.finished_at", ">", plan.finished_at)
        .where((eb) => eb.not(eb.exists(eb.selectFrom("requests as x").select("x.id").whereRef("x.plan_run_id", "=", "p.id").where("x.status", "in", [...LIVE])))).orderBy("p.finished_at", "desc").limit(3).execute()
      : [];
    return {
      request: { ...row(r, project.name, sizeOf(plan)), planRunId: r.plan_run_id, decidedAt: r.decided_at },
      plan: plan ? { id: plan.id, summary: plan.summary ?? null, createdBy: plan.created_by, finishedAt: plan.finished_at } : null,
      apply: { blockers, stale, expiresAt, destructive },
      events: events.map((e) => ({ id: e.id, at: e.at, actor: e.actor, kind: e.kind, body: e.body, data: e.data })),
      can: { ...can, comment: true },
      newerPlans: newer,
      me: me.username,
    };
  });

  const decide = (kind: "approve" | "reject") => async (req: FastifyRequest) => {
    const { r, project, statements } = await open(req, (req.params as { id: string }).id);
    sessionOnly(req);
    const me = actor(req);
    if (r.status !== "waiting") throw new HttpError(409, "not_waiting", "This request is not waiting for a decision.");
    const plan = await planOf(r.plan_run_id);
    const can = requestCan(statements, project.id, me.userId, r, destructiveOf(plan));
    if (r.requester_id === me.userId) throw new HttpError(403, "self_approval", "Whoever sent the request cannot decide it.");
    if (!evaluate(statements, { action: "run:Approve", resource: resource.project(project.id) }).allowed) {
      await audit(db, { actor: me, action: "authz.denied", resource: resource.project(project.id), outcome: "denied", ip: req.ip, details: { action: "run:Approve" } });
      throw new HttpError(403, "forbidden", "You are not allowed to do that.");
    }
    if (kind === "approve" && can.approveBlocked) throw new HttpError(403, "destructive_forbidden", "This plan deletes or replaces resources; approving it needs the run:ApplyDestructive permission.");
    const note = ((req.body as { note?: string } | null)?.note ?? "").trim();
    if (kind === "reject" && !note) throw new HttpError(400, "reason_required", "Say why it is rejected.");
    await db.transaction().execute(async (trx) => {
      await trx.updateTable("requests").set(kind === "approve"
        ? { status: "approved", decided_by_id: me.userId, decided_by: me.username, decided_at: new Date() }
        : { status: "closed", close_reason: "rejected", decided_by_id: me.userId, decided_by: me.username, decided_at: new Date() }).where("id", "=", r.id).execute();
      await addEvent(trx, r.id, me, kind === "approve" ? "approved" : "rejected", note || null);
    });
    await audit(db, { actor: me, action: kind === "approve" ? "request.approved" : "request.rejected", resource: resource.project(project.id), outcome: "success", ip: req.ip, details: { request: r.id, number: r.number } });
    return { ok: true };
  };
  const noteBody = { type: "object", additionalProperties: false, properties: { note: { type: "string", maxLength: MAX_COMMENT } } } as const;
  app.post("/api/requests/:id/approve", { schema: { params: idParams, body: noteBody } }, decide("approve"));
  app.post("/api/requests/:id/reject", { schema: { params: idParams, body: noteBody } }, decide("reject"));

  app.post("/api/requests/:id/withdraw", { schema: { params: idParams } }, async (req) => {
    const { r, project } = await open(req, (req.params as { id: string }).id);
    sessionOnly(req);
    const me = actor(req);
    if (r.requester_id !== me.userId) throw new HttpError(403, "forbidden", "Only whoever sent the request can withdraw it.");
    if (r.status !== "waiting" && r.status !== "approved") throw new HttpError(409, "not_open", "This request is no longer open.");
    await db.transaction().execute(async (trx) => {
      await trx.updateTable("requests").set({ status: "closed", close_reason: "withdrawn" }).where("id", "=", r.id).execute();
      await addEvent(trx, r.id, me, "withdrawn");
    });
    await audit(db, { actor: me, action: "request.withdrawn", resource: resource.project(project.id), outcome: "success", ip: req.ip, details: { request: r.id, number: r.number } });
    return { ok: true };
  });

  app.post("/api/requests/:id/comments", {
    schema: { params: idParams, body: { type: "object", required: ["body"], additionalProperties: false, properties: { body: { type: "string", minLength: 1, maxLength: MAX_COMMENT } } } },
  }, async (req) => {
    const { r } = await open(req, (req.params as { id: string }).id);
    const me = actor(req);
    const body = (req.body as { body: string }).body.trim();
    if (!body) throw new HttpError(400, "invalid_request", "A comment cannot be empty.");
    await addEvent(db, r.id, me, "comment", body);
    return { ok: true };
  });

  /** Puts a newer, successful plan into the request: the approval is cleared and the talk stays, like pushing a commit to a pull request. */
  app.post("/api/requests/:id/replan", {
    schema: { params: idParams, body: { type: "object", required: ["planRunId"], additionalProperties: false, properties: { planRunId: { type: "string", format: "uuid" } } } },
  }, async (req) => {
    const { r, project, statements } = await open(req, (req.params as { id: string }).id);
    sessionOnly(req);
    const me = actor(req);
    if (r.requester_id !== me.userId) throw new HttpError(403, "forbidden", "Only whoever sent the request can change its plan.");
    if (!evaluate(statements, { action: "run:Plan", resource: resource.project(project.id) }).allowed) throw new HttpError(403, "forbidden", "You are not allowed to do that.");
    if (r.status !== "waiting" && r.status !== "approved") throw new HttpError(409, "not_open", "This request is no longer open.");
    const { planRunId } = req.body as { planRunId: string };
    const plan = await db.selectFrom("runs").select(["id", "project_id", "kind", "status", "summary", "created_by", "finished_at", "files_hash", "variables_hash", "connection_id", "state_serial", sql<boolean>`plan_data is not null`.as("has_plan")]).where("id", "=", planRunId).executeTakeFirst();
    if (!plan || plan.project_id !== project.id || plan.kind !== "plan") throw notFound("No such plan.");
    const st = await applyState(db, config, { id: plan.id, kind: "plan", status: plan.status, hasPlan: !!plan.has_plan, finished_at: plan.finished_at, files_hash: plan.files_hash, variables_hash: plan.variables_hash, connection_id: plan.connection_id, state_serial: plan.state_serial, created_by: plan.created_by, destructive: destructiveOf(plan) }, project);
    const blocking = st.blockers.filter((b) => b.code !== "rescue_pending");
    if (blocking.length) throw new HttpError(409, blocking[0]!.code, "That plan cannot be used.", { blockers: blocking });
    try {
      await db.transaction().execute(async (trx) => {
        await trx.updateTable("requests").set({ plan_run_id: plan.id, status: "waiting", decided_by_id: null, decided_by: null, decided_at: null }).where("id", "=", r.id).execute();
        await addEvent(trx, r.id, me, "replanned", null, { from: r.plan_run_id, to: plan.id });
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "23505") throw new HttpError(409, "request_exists", "That plan is already in a request.");
      throw e;
    }
    await audit(db, { actor: me, action: "request.replanned", resource: resource.project(project.id), outcome: "success", ip: req.ip, details: { request: r.id, number: r.number, plan: plan.id } });
    return { ok: true };
  });

}

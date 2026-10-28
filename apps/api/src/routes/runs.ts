import { createHash } from "node:crypto";
import { resource, type Statement } from "@av2i/authz";
import { checkDesign, upgradeDesign, type Design } from "@av2i/model";
import { getRegistry } from "@av2i/registry";
import { runRules } from "@av2i/rules";
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { audit } from "../audit.ts";
import { applyPath, applyState, filesHash } from "../runs/apply.ts";
import { addEvent, liveRequestOf, LIVE, requestCan } from "../requests.ts";
import type { Ctx } from "../context.ts";
import { HttpError, notFound } from "../errors.ts";
import { projectAccess } from "../project-access.ts";
import { sessionName } from "../aws.ts";
import { evaluate } from "@av2i/authz";
import { authOf, sessionOnly } from "../context.ts";
import { requireKey } from "../runs/crypto.ts";
import { tofuVersion } from "../runs/runner.ts";
import { requiredOf, stampOf, storedOf } from "../runs/variables.ts";

const idParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
/** Waiting runs per project: a person who keeps pressing Plan cannot fill the queue. */
const MAX_QUEUED = 5;

export interface RunsHooks {
  /** called after a run is queued so a worker looks for it now */
  wake?: () => void;
}
export const runsHooks: RunsHooks = {};

/** An assumed role answers the same for a minute: the dialog asks again each time it opens. */
const PREFLIGHT = new Map<string, { at: number; stamp: string; result: unknown }>();

export function runRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config, aws } = ctx;
  const { actor, authorize } = projectAccess(ctx);
  const projectOf = async (id: string) => {
    const row = await db.selectFrom("projects").select(["id", "owner_id", "design", "name", "connection_id"]).where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
    if (!row) throw notFound("No such project.");
    return row;
  };
  const runOf = async (id: string) => {
    const row = await db.selectFrom("runs").select(["id", "project_id", "kind", "status", "design_hash", "created_by", "created_at", "started_at", "finished_at", "error", "summary", "state_serial", "plan_run_id", "files_hash", "variables_hash", "connection_id", sql<boolean>`plan_data is not null`.as("has_plan")]).where("id", "=", id).executeTakeFirst();
    if (!row) throw notFound("No such run.");
    return row;
  };
  const view = async (r: Awaited<ReturnType<typeof runOf>>) => {
    const who = r.created_by ? (await db.selectFrom("users").select("username").where("id", "=", r.created_by).executeTakeFirst())?.username ?? null : null;
    return { id: r.id, projectId: r.project_id, kind: r.kind, status: r.status, createdBy: who, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, error: r.error, summary: r.summary ?? null, planRunId: r.plan_run_id };
  };

  app.post("/api/projects/:id/runs", {
    schema: { params: idParams, body: { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["plan"] } } } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await projectOf(id);
    await authorize(req, project, "run:Plan");
    requireKey(config.stateKey);
    const design = upgradeDesign(project.design as Design);
    const registry = getRegistry();
    const structural = checkDesign(design, registry);
    if (structural.length) throw new HttpError(422, "design_invalid", "The design is not valid.", { problems: structural.map((p) => `${p.where}: ${p.message}`) });
    const errors = runRules(design, registry).filter((f) => f.severity === "error");
    if (errors.length) throw new HttpError(422, "design_has_errors", "Fix the errors in the design first.", { findings: errors.map((f) => ({ rule: f.rule, targets: f.targets, message: f.message })) });
    // whoever may plan the project plans against its connection; connection:Use was needed to choose it (DD-028)
    if (!project.connection_id && !config.runWithServerIdentity) throw new HttpError(422, "no_connection", "Choose an AWS connection for this project first.");
    const pending = await db.selectFrom("state_rescues").select("id").where("project_id", "=", id).where("resolved_at", "is", null).executeTakeFirst();
    if (pending) throw new HttpError(409, "rescue_pending", "An apply left a state that was not saved. Restore, download or dismiss it before running anything.");
    const required = requiredOf(design);
    const stored = await storedOf(db, id);
    const missing = required.filter((v) => !stored.some((s) => s.name === v.name)).map((v) => v.name);
    if (missing.length) throw new HttpError(422, "variables_missing", "The design needs values that are not set yet.", { variables: missing });
    const waiting = await db.selectFrom("runs").select(db.fn.countAll<string>().as("n")).where("project_id", "=", id).where("status", "=", "queued").executeTakeFirstOrThrow();
    if (Number(waiting.n) >= MAX_QUEUED) throw new HttpError(429, "queue_full", "This project already has several runs waiting.");
    const json = JSON.stringify(design);
    const me = actor(req);
    const row = await db.insertInto("runs").values({ project_id: id, kind: "plan", design: json, design_hash: createHash("sha256").update(json).digest("hex"), created_by: me.userId, error: null, plan_data: null, plan_nonce: null, plan_key_id: null, state_serial: null, state_token_hash: null, variables_hash: stampOf(required, stored), connection_id: project.connection_id, files_hash: filesHash(design) })
      .returning("id").executeTakeFirstOrThrow();
    await audit(db, { actor: me, action: "run.queued", resource: resource.project(id), outcome: "success", ip: req.ip, details: { run: row.id, kind: "plan" } });
    runsHooks.wake?.();
    reply.code(201);
    return { run: await view(await runOf(row.id)) };
  });

  /** What a run would use, so the studio can say what is missing before anyone presses Plan. */
  app.get("/api/projects/:id/preflight", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const project = await projectOf(id);
    // anyone who can read the project may see the state of its runs; only who may plan sees what a plan would use
    const statements = await authorize(req, project, "project:Read");
    const mayPlan = evaluate(statements, { action: "run:Plan", resource: resource.project(id) }).allowed;
    const connection = project.connection_id
      ? await db.selectFrom("aws_connections").select(["id", "name", "plan_role_arn", "apply_role_arn", "external_id", "updated_at"]).where("id", "=", project.connection_id).executeTakeFirst()
      : undefined;
    const identity = await (async () => {
      if (!mayPlan) return { ok: false as const, reason: "forbidden" as const, message: "You may not plan this project." };
      if (!connection) {
        if (!config.runWithServerIdentity) return { ok: false as const, reason: "no_connection" as const, message: "No connection." };
        const r = await aws.identity();
        return r.ok ? { ...r, via: "server" as const } : r;
      }
      const cached = PREFLIGHT.get(connection.id);
      if (cached && cached.at > Date.now() - 60_000 && cached.stamp === `${connection.updated_at.getTime()}`) return cached.result;
      const a = await aws.assume({ roleArn: connection.plan_role_arn, externalId: connection.external_id, sessionName: sessionName("preflight", id) });
      const result = !a.ok ? { ok: false as const, reason: a.code, message: a.message, roleArn: connection.plan_role_arn }
        : await aws.identity(a.keys).then((i) => (i.ok ? { ok: true as const, account: i.account, arn: i.arn, via: "role" as const, roleArn: connection.plan_role_arn } : { ok: false as const, reason: "error" as const, message: i.message, roleArn: connection.plan_role_arn }));
      PREFLIGHT.set(connection.id, { at: Date.now(), stamp: `${connection.updated_at.getTime()}`, result });
      return result;
    })();
    const tofu = mayPlan ? await tofuVersion(config.tofuBin) : { ok: false as const, message: "" };
    const rescuePending = !!(await db.selectFrom("state_rescues").select("id").where("project_id", "=", id).where("resolved_at", "is", null).executeTakeFirst());
    return { rescuePending, key: !!config.stateKey, tofu, identity, connection: connection ? { id: connection.id, name: connection.name, planOnly: !connection.apply_role_arn } : null, timeoutMinutes: Math.round(config.runTimeoutMs / 60_000) };
  });

  app.get("/api/projects/:id/runs", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    await authorize(req, await projectOf(id), "project:Read");
    const rows = await db.selectFrom("runs").select(["id", "project_id", "kind", "status", "design_hash", "created_by", "created_at", "started_at", "finished_at", "error", "summary", "state_serial", "plan_run_id", "files_hash", "variables_hash", "connection_id", sql<boolean>`plan_data is not null`.as("has_plan")]).where("project_id", "=", id).orderBy("created_at", "desc").limit(50).execute();
    return { runs: await Promise.all(rows.map(view)) };
  });

  const loadRun = async (req: Parameters<typeof authorize>[0], runId: string, action: Parameters<typeof authorize>[2]): Promise<[Awaited<ReturnType<typeof runOf>>, Statement[]]> => {
    const run = await runOf(runId);
    return [run, await authorize(req, await projectOf(run.project_id), action)];
  };

  const facts = (run: Awaited<ReturnType<typeof runOf>>) => ({
    id: run.id, kind: run.kind, status: run.status, hasPlan: !!run.has_plan, finished_at: run.finished_at, files_hash: run.files_hash, variables_hash: run.variables_hash,
    connection_id: run.connection_id, state_serial: run.state_serial, created_by: run.created_by, destructive: !!(run.summary as { destructive?: boolean } | null)?.destructive,
  });

  /** A plan with what stands between it and its apply, the request that covers it, and what the signed-in person may do (DD-027). */
  app.get("/api/runs/:id", { schema: { params: idParams } }, async (req) => {
    const [run, statements] = await loadRun(req, (req.params as { id: string }).id, "project:Read");
    const base = await view(run);
    if (run.kind !== "plan" || run.status !== "succeeded") return { run: base };
    const project = await projectOf(run.project_id);
    const st = await applyState(db, config, facts(run), project);
    const me = actor(req);
    const live = await liveRequestOf(db, run.id);
    const may = (action: "run:Plan" | "run:Approve" | "run:Apply" | "run:ApplyDestructive") => evaluate(statements, { action, resource: resource.project(run.project_id) }).allowed;
    const path = applyPath(statements, project.id, me.userId, live ?? null, st.destructive);
    // the person's own requests that this plan could replace (a newer plan for the same change)
    const replaceable = may("run:Plan") && !live && run.finished_at
      ? await db.selectFrom("requests as q").innerJoin("runs as p", "p.id", "q.plan_run_id").select(["q.id", "q.number"]).where("q.project_id", "=", project.id).where("q.requester_id", "=", me.userId).where("q.status", "in", [...LIVE]).where("p.finished_at", "<", run.finished_at).execute()
      : [];
    const applyRun = await db.selectFrom("runs").select(["id", "status"]).where("plan_run_id", "=", run.id).where("kind", "=", "apply").orderBy("created_at", "desc").limit(1).executeTakeFirst();
    return {
      run: base,
      apply: { blockers: st.blockers, destructive: st.destructive, expiresAt: st.expiresAt, applyRun: applyRun ?? null },
      request: live ? { id: live.id, number: live.number, status: live.status, requester: live.requester, decidedBy: live.decided_by, can: requestCan(statements, project.id, me.userId, live, st.destructive) } : null,
      can: { plan: may("run:Plan"), approve: may("run:Approve"), apply: may("run:Apply"), applyDestructive: may("run:ApplyDestructive"), applyNow: path.ok, applyBlocked: path.ok ? null : path.code, request: may("run:Plan") && !live && !path.ok },
      replaceable,
    };
  });

  /** Sends a plan for approval: request #n of the project, with an optional note (DD-027). */
  app.post("/api/runs/:id/request", {
    schema: { params: idParams, body: { type: "object", additionalProperties: false, properties: { note: { type: "string", maxLength: 5000 } } } },
  }, async (req, reply) => {
    const [run] = await loadRun(req, (req.params as { id: string }).id, "run:Plan");
    sessionOnly(req);
    const me = actor(req);
    const project = await projectOf(run.project_id);
    const st = await applyState(db, config, facts(run), project);
    const blocking = st.blockers.filter((b) => b.code !== "rescue_pending");
    if (blocking.length) throw new HttpError(409, blocking[0]!.code, "This plan cannot be sent for approval.", { blockers: blocking });
    try {
      const made = await db.transaction().execute(async (trx) => {
        const seq = await trx.updateTable("projects").set({ request_seq: sql`request_seq + 1` }).where("id", "=", project.id).returning("request_seq").executeTakeFirstOrThrow();
        const q = await trx.insertInto("requests").values({ project_id: project.id, number: seq.request_seq, kind: "apply", plan_run_id: run.id, requester_id: me.userId, requester: me.username }).returning(["id", "number"]).executeTakeFirstOrThrow();
        await addEvent(trx, q.id, me, "requested", (req.body as { note?: string } | null)?.note?.trim() || null, { plan: run.id });
        return q;
      });
      await audit(db, { actor: me, action: "request.created", resource: resource.project(project.id), outcome: "success", ip: req.ip, details: { request: made.id, number: made.number, plan: run.id } });
      reply.code(201);
      return { request: { id: made.id, number: made.number } };
    } catch (e) {
      if ((e as { code?: string })?.code === "23505") throw new HttpError(409, "request_exists", "This plan is already in a request.");
      throw e;
    }
  });

  /** Queues the apply of a plan, once every condition holds (DD-026, section 2) and the person may (DD-027, section 3). */
  app.post("/api/runs/:id/apply", {
    schema: { params: idParams, body: { type: "object", additionalProperties: false, properties: { confirmName: { type: "string", maxLength: 200 } } } },
  }, async (req, reply) => {
    const [run, statements] = await loadRun(req, (req.params as { id: string }).id, "project:Read");
    sessionOnly(req);
    const me = actor(req);
    const project = await projectOf(run.project_id);
    const st = await applyState(db, config, facts(run), project);
    const live = await liveRequestOf(db, run.id);
    const path = applyPath(statements, project.id, me.userId, live ?? null, st.destructive);
    if (!path.ok) {
      const text = { destructive_forbidden: "This plan deletes or replaces resources; applying it needs the run:ApplyDestructive permission.", awaiting_approval: "This plan is waiting for approval.", request_needed: "Send this plan for approval first." }[path.code];
      throw new HttpError(403, path.code, text);
    }
    if (st.destructive && (req.body as { confirmName?: string } | null)?.confirmName !== project.name) throw new HttpError(409, "confirm_required", "Type the project name to apply a plan that deletes or replaces resources.");
    if (st.blockers.length) throw new HttpError(409, st.blockers[0]!.code, "This plan cannot be applied now.", { blockers: st.blockers });
    const full = await db.selectFrom("runs").select(["design", "design_hash"]).where("id", "=", run.id).executeTakeFirstOrThrow();
    try {
      const row = await db.insertInto("runs").values({
        project_id: project.id, kind: "apply", design: JSON.stringify(full.design), design_hash: full.design_hash, created_by: me.userId, error: null, plan_data: null, plan_nonce: null, plan_key_id: null,
        state_serial: run.state_serial, state_token_hash: null, variables_hash: run.variables_hash, connection_id: run.connection_id, files_hash: run.files_hash, plan_run_id: run.id,
      }).returning("id").executeTakeFirstOrThrow();
      await audit(db, { actor: me, action: "run.apply_queued", resource: resource.project(project.id), outcome: "success", ip: req.ip, details: { run: row.id, plan: run.id, destructive: st.destructive, via: path.via } });
      runsHooks.wake?.();
      reply.code(201);
      return { run: await view(await runOf(row.id)) };
    } catch (e) {
      if ((e as { code?: string })?.code === "23505") throw new HttpError(409, "already_applied", "This plan is being applied or was applied.");
      throw e;
    }
  });

  app.get("/api/runs/:id/logs", {
    schema: { params: idParams, querystring: { type: "object", properties: { after: { type: "integer", minimum: 0 } } } },
  }, async (req) => {
    const [run] = await loadRun(req, (req.params as { id: string }).id, "project:Read");
    const after = (req.query as { after?: number }).after ?? 0;
    const lines = await db.selectFrom("run_logs").select(["seq", "line"]).where("run_id", "=", run.id).where("seq", ">", after).orderBy("seq").limit(2000).execute();
    return { lines, done: run.status !== "queued" && run.status !== "running" };
  });

  app.post("/api/runs/:id/cancel", { schema: { params: idParams } }, async (req) => {
    const [run] = await loadRun(req, (req.params as { id: string }).id, "run:Plan");
    const r = await db.updateTable("runs").set({ status: "cancelled", finished_at: new Date() }).where("id", "=", run.id).where("status", "=", "queued").executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new HttpError(409, "not_queued", "Only a run that is still waiting can be cancelled.");
    await audit(db, { actor: actor(req), action: "run.cancelled", resource: resource.project(run.project_id), outcome: "success", ip: req.ip, details: { run: run.id } });
    return { run: await view(await runOf(run.id)) };
  });
}

import { randomBytes } from "node:crypto";
import { evaluate, resource } from "@av2i/authz";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { accountOf, planPolicy, principalOf, ROLE_ARN, sessionName, trustPolicy } from "../aws.ts";
import { audit } from "../audit.ts";
import { authOf, need, type Ctx } from "../context.ts";
import { badRequest, conflict, forbidden, notFound } from "../errors.ts";
import { projectAccess } from "../project-access.ts";

const idParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const ALL = resource.connection("*");

interface Row {
  id: string;
  name: string;
  description: string;
  plan_role_arn: string;
  apply_role_arn: string | null;
  external_id: string;
  created_at: Date;
  updated_at: Date;
  last_test_at: Date | null;
  last_test: unknown;
}

/** AWS connections (DD-025): the roles a project's runs assume. Only ARNs and an ExternalId are kept. */
export function connectionRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, aws } = ctx;
  const { actor, authorize } = projectAccess(ctx);

  const can = async (req: FastifyRequest, action: "connection:Manage" | "connection:Use", id: string) =>
    evaluate(await authOf(req).statements(), { action, resource: resource.connection(id) }).allowed;

  const load = async (id: string): Promise<Row> => {
    const row = await db.selectFrom("aws_connections").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw notFound("No such connection.");
    return row as Row;
  };

  /** Someone who may not even use the connection gets 404, like a project they cannot read; someone who may use it but not manage it, 403. */
  const manage = async (req: FastifyRequest, id: string): Promise<Row> => {
    const row = await load(id);
    if (!(await can(req, "connection:Manage", id))) {
      if (!(await can(req, "connection:Use", id))) throw notFound("No such connection.");
      await audit(db, { actor: actor(req), action: "authz.denied", resource: resource.connection(id), outcome: "denied", ip: req.ip, details: { action: "connection:Manage" } });
      throw forbidden();
    }
    return row;
  };

  const full = (r: Row) => ({
    id: r.id, name: r.name, description: r.description, planRoleArn: r.plan_role_arn, applyRoleArn: r.apply_role_arn, account: accountOf(r.plan_role_arn),
    planOnly: !r.apply_role_arn, createdAt: r.created_at, updatedAt: r.updated_at, lastTestAt: r.last_test_at, lastTest: r.last_test ?? null,
  });
  const brief = (r: Row) => ({ id: r.id, name: r.name, description: r.description, account: accountOf(r.plan_role_arn), planOnly: !r.apply_role_arn });

  /** The roles must be role ARNs and in one account. Returns the problem, or null. */
  const check = (plan: string, apply: string | null): [string, string] | null => {
    if (!ROLE_ARN.test(plan)) return ["invalid_role_arn", "The plan role must be the ARN of an IAM role, like arn:aws:iam::123456789012:role/name."];
    if (apply !== null && !ROLE_ARN.test(apply)) return ["invalid_role_arn", "The apply role must be the ARN of an IAM role, like arn:aws:iam::123456789012:role/name."];
    if (apply !== null && accountOf(apply) !== accountOf(plan)) return ["accounts_differ", "The plan role and the apply role must be in the same AWS account."];
    return null;
  };
  const nameOf = (v: unknown): string => {
    const n = typeof v === "string" ? v.trim() : "";
    if (n.length < 2 || n.length > 64) throw badRequest("invalid_name", "A connection name is 2 to 64 characters.");
    return n;
  };
  const taken = (e: unknown) => (e as { code?: string })?.code === "23505";

  const body = {
    type: "object", additionalProperties: false,
    properties: { name: { type: "string" }, description: { type: "string", maxLength: 500 }, planRoleArn: { type: "string", maxLength: 600 }, applyRoleArn: { type: ["string", "null"], maxLength: 600 } },
  } as const;

  app.get("/api/connections", async (req) => {
    const rows = (await db.selectFrom("aws_connections").selectAll().orderBy("name").execute()) as Row[];
    const out: ({ view: "full" } & ReturnType<typeof full> | { view: "brief" } & ReturnType<typeof brief>)[] = [];
    for (const r of rows) {
      if (await can(req, "connection:Manage", r.id)) out.push({ view: "full", ...full(r) });
      else if (await can(req, "connection:Use", r.id)) out.push({ view: "brief", ...brief(r) });
    }
    const usage = await db.selectFrom("projects").select(["connection_id", db.fn.countAll<string>().as("n")]).where("connection_id", "is not", null).where("deleted_at", "is", null).groupBy("connection_id").execute();
    const n = new Map(usage.map((u) => [u.connection_id, Number(u.n)]));
    return { connections: out.map((c) => (c.view === "full" ? { ...c, projects: n.get(c.id) ?? 0 } : c)) };
  });

  app.post("/api/connections", { schema: { body: { ...body, required: ["name", "planRoleArn"] } } }, async (req, reply) => {
    await need(ctx, req, "connection:Manage", ALL);
    const b = req.body as { name: string; description?: string; planRoleArn: string; applyRoleArn?: string | null };
    const name = nameOf(b.name);
    const problem = check(b.planRoleArn, b.applyRoleArn ?? null);
    if (problem) throw badRequest(...problem);
    const me = actor(req);
    try {
      const row = await db.insertInto("aws_connections").values({ name, description: b.description ?? "", plan_role_arn: b.planRoleArn, apply_role_arn: b.applyRoleArn ?? null, external_id: randomBytes(32).toString("hex"), created_by: me.userId, last_test: null })
        .returningAll().executeTakeFirstOrThrow();
      await audit(db, { actor: me, action: "connection.created", resource: resource.connection(row.id), outcome: "success", ip: req.ip, details: { name, planRole: b.planRoleArn, applyRole: b.applyRoleArn ?? null } });
      reply.code(201);
      return { connection: full(row as Row) };
    } catch (e) {
      if (taken(e)) throw conflict("name_taken", "A connection with this name exists.");
      throw e;
    }
  });

  app.get("/api/connections/:id", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const row = await manage(req, id);
    const who = await aws.identity();
    const principal = who.ok ? principalOf(who.arn) : null;
    const usedBy = await db.selectFrom("projects").select(["id", "name"]).where("connection_id", "=", id).where("deleted_at", "is", null).orderBy("name").execute();
    return {
      connection: { ...full(row), externalId: row.external_id },
      usedBy,
      server: who.ok ? { ok: true, arn: who.arn, account: who.account, source: who.source, principal: principal!.principal, pathWarning: principal!.pathWarning } : { ok: false, message: who.message },
      trustPolicy: principal ? trustPolicy(principal.principal, row.external_id) : null,
      planPolicy: planPolicy(),
    };
  });

  app.patch("/api/connections/:id", { schema: { params: idParams, body } }, async (req) => {
    const { id } = req.params as { id: string };
    const row = await manage(req, id);
    const b = req.body as { name?: string; description?: string; planRoleArn?: string; applyRoleArn?: string | null };
    const plan = b.planRoleArn ?? row.plan_role_arn;
    const apply = b.applyRoleArn !== undefined ? b.applyRoleArn : row.apply_role_arn;
    const problem = check(plan, apply);
    if (problem) throw badRequest(...problem);
    const rolesChanged = plan !== row.plan_role_arn || apply !== row.apply_role_arn;
    try {
      const upd = await db.updateTable("aws_connections").set({
        name: b.name !== undefined ? nameOf(b.name) : row.name, description: b.description ?? row.description, plan_role_arn: plan, apply_role_arn: apply, updated_at: new Date(),
        // the last test belonged to the old roles
        ...(rolesChanged ? { last_test_at: null, last_test: null } : {}),
      }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
      await audit(db, { actor: actor(req), action: "connection.updated", resource: resource.connection(id), outcome: "success", ip: req.ip, details: { planRole: plan, applyRole: apply } });
      return { connection: full(upd as Row) };
    } catch (e) {
      if (taken(e)) throw conflict("name_taken", "A connection with this name exists.");
      throw e;
    }
  });

  app.delete("/api/connections/:id", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const row = await manage(req, id);
    const used = await db.selectFrom("projects").select(db.fn.countAll<string>().as("n")).where("connection_id", "=", id).where("deleted_at", "is", null).executeTakeFirstOrThrow();
    if (Number(used.n) > 0) throw conflict("connection_in_use", `${used.n} project(s) use this connection; choose another for them first.`);
    // a soft-deleted project may still point here: let it go with the connection
    await db.updateTable("projects").set({ connection_id: null }).where("connection_id", "=", id).execute();
    await db.deleteFrom("aws_connections").where("id", "=", id).execute();
    await audit(db, { actor: actor(req), action: "connection.deleted", resource: resource.connection(id), outcome: "success", ip: req.ip, details: { name: row.name } });
    return { ok: true };
  });

  /** Assumes each role as a run would and asks AWS who it is then; the answer is kept on the connection. */
  app.post("/api/connections/:id/test", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const row = await manage(req, id);
    const me = actor(req);
    const one = async (roleArn: string) => {
      const a = await aws.assume({ roleArn, externalId: row.external_id, sessionName: sessionName(`test-${me.username}`, id) });
      if (!a.ok) return { ok: false as const, code: a.code, message: a.message };
      const i = await aws.identity(a.keys);
      return i.ok ? { ok: true as const, arn: i.arn, account: i.account } : { ok: false as const, code: "other" as const, message: i.message };
    };
    const result = { plan: await one(row.plan_role_arn), apply: row.apply_role_arn ? await one(row.apply_role_arn) : null };
    const at = new Date();
    await db.updateTable("aws_connections").set({ last_test_at: at, last_test: JSON.stringify(result) }).where("id", "=", id).execute();
    await audit(db, { actor: me, action: "connection.tested", resource: resource.connection(id), outcome: result.plan.ok && (result.apply?.ok ?? true) ? "success" : "failure", ip: req.ip, details: { plan: result.plan.ok, apply: result.apply ? result.apply.ok : null } });
    return { lastTestAt: at, result };
  });

  app.get("/api/server-identity", async (req) => {
    await need(ctx, req, "connection:Manage", ALL);
    const who = await aws.identity();
    if (!who.ok) return { ok: false, reason: who.reason, message: who.message };
    const p = principalOf(who.arn);
    return { ok: true, arn: who.arn, account: who.account, source: who.source, principal: p.principal, pathWarning: p.pathWarning };
  });

  app.put("/api/projects/:id/connection", {
    schema: { params: idParams, body: { type: "object", required: ["connectionId"], additionalProperties: false, properties: { connectionId: { type: ["string", "null"], format: "uuid" } } } },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const project = await db.selectFrom("projects").select(["id", "owner_id", "connection_id"]).where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
    if (!project) throw notFound("No such project.");
    await authorize(req, project, "project:Write");
    const target = (req.body as { connectionId: string | null }).connectionId;
    if (target !== null && target !== project.connection_id) {
      const exists = await db.selectFrom("aws_connections").select("id").where("id", "=", target).executeTakeFirst();
      if (!exists || !(await can(req, "connection:Use", target))) throw badRequest("no_such_connection", "You may not use that connection.");
    }
    await db.updateTable("projects").set({ connection_id: target }).where("id", "=", id).execute();
    await audit(db, { actor: actor(req), action: "project.connection_set", resource: resource.project(id), outcome: "success", ip: req.ip, details: { from: project.connection_id, to: target } });
    return { ok: true };
  });
}

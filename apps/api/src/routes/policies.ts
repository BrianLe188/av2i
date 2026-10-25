import { ACTIONS, evaluate, parseDocument, resource } from "@av2i/authz";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "kysely";
import { statementsFor } from "../access.ts";
import { audit } from "../audit.ts";
import { authOf, need, type Ctx } from "../context.ts";
import { badRequest, conflict, HttpError, notFound } from "../errors.ts";

const NAME = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const MAX_DOCUMENT = 64 * 1024;
const nameParams = { type: "object", required: ["name"], properties: { name: { type: "string", maxLength: 64 } } } as const;

export function policyRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const actor = (req: FastifyRequest) => {
    const s = authOf(req).session;
    return { userId: s.userId, username: s.username };
  };
  const find = async (name: string) => {
    const p = await db.selectFrom("policies").selectAll().where("name", "=", name).executeTakeFirst();
    if (!p) throw notFound("No such policy.");
    return p;
  };
  /** A document is valid when it parses and is not absurdly large; the reasons come back to the person writing it. */
  const checked = (document: unknown) => {
    if (JSON.stringify(document).length > MAX_DOCUMENT) throw badRequest("policy_too_large", "A policy document may be at most 64 KB.");
    const parsed = parseDocument(document);
    if (!parsed.ok) throw new HttpError(400, "invalid_policy", "The policy document has problems.", { problems: parsed.errors });
  };
  const attachedTo = async (policyId: string) => ({
    users: await db.selectFrom("policy_attachments as pa").innerJoin("users as u", "u.id", "pa.user_id").select(["u.id", "u.username"]).where("pa.policy_id", "=", policyId).orderBy("u.username").execute(),
    groups: await db.selectFrom("policy_attachments as pa").innerJoin("groups as g", "g.id", "pa.group_id").select(["g.id", "g.name"]).where("pa.policy_id", "=", policyId).orderBy("g.name").execute(),
  });

  app.get("/api/policies", async (req) => {
    await need(ctx, req, "policy:Manage", resource.policy("*"));
    const rows = await db.selectFrom("policies").select(["id", "name", "description", "builtin", "updated_at"]).orderBy("builtin", "desc").orderBy("name").execute();
    const counts = await sql<{ policy_id: string; users: string; groups: string }>`
      select policy_id, count(user_id) as users, count(group_id) as groups from policy_attachments group by policy_id`.execute(db);
    return {
      policies: rows.map((p) => {
        const c = counts.rows.find((r) => r.policy_id === p.id);
        return { name: p.name, description: p.description, builtin: p.builtin, updatedAt: p.updated_at, users: Number(c?.users ?? 0), groups: Number(c?.groups ?? 0) };
      }),
    };
  });

  app.get("/api/policies/:name", { schema: { params: nameParams } }, async (req) => {
    const { name } = req.params as { name: string };
    await need(ctx, req, "policy:Manage", resource.policy(name));
    const p = await find(name);
    return { policy: { name: p.name, description: p.description, builtin: p.builtin, document: p.document, updatedAt: p.updated_at }, ...(await attachedTo(p.id)) };
  });

  app.post("/api/policies", {
    schema: { body: { type: "object", required: ["name", "document"], additionalProperties: false, properties: { name: { type: "string", maxLength: 64 }, description: { type: "string", maxLength: 300 }, document: { type: "object" } } } },
  }, async (req, reply) => {
    const body = req.body as { name: string; description?: string; document: unknown };
    const name = body.name.trim();
    await need(ctx, req, "policy:Manage", resource.policy(name));
    if (!NAME.test(name)) throw badRequest("invalid_policy_name", "A policy name is 2 to 64 letters, digits, dots, dashes or underscores, and starts with a letter or digit.");
    checked(body.document);
    if (await db.selectFrom("policies").select("id").where("name", "=", name).executeTakeFirst()) throw conflict("policy_taken", "That policy name is taken.");
    await db.insertInto("policies").values({ name, description: body.description?.trim() ?? "", document: JSON.stringify(body.document), builtin: false }).execute();
    await audit(db, { actor: actor(req), action: "policy.created", resource: resource.policy(name), outcome: "success", ip: req.ip });
    reply.code(201);
    return { policy: { name } };
  });

  app.put("/api/policies/:name", {
    schema: { params: nameParams, body: { type: "object", additionalProperties: false, minProperties: 1, properties: { description: { type: "string", maxLength: 300 }, document: { type: "object" } } } },
  }, async (req) => {
    const { name } = req.params as { name: string };
    await need(ctx, req, "policy:Manage", resource.policy(name));
    const p = await find(name);
    if (p.builtin) throw conflict("builtin_policy", "A built-in policy cannot be changed.");
    const body = req.body as { description?: string; document?: unknown };
    if (body.document !== undefined) checked(body.document);
    await db.updateTable("policies").set({
      ...(body.description !== undefined ? { description: body.description.trim() } : {}),
      ...(body.document !== undefined ? { document: JSON.stringify(body.document) } : {}),
      updated_at: new Date(),
    }).where("id", "=", p.id).execute();
    await audit(db, { actor: actor(req), action: "policy.updated", resource: resource.policy(name), outcome: "success", ip: req.ip, details: { document: body.document !== undefined } });
    return { ok: true };
  });

  app.delete("/api/policies/:name", {
    schema: { params: nameParams, querystring: { type: "object", properties: { force: { type: "boolean", default: false } } } },
  }, async (req) => {
    const { name } = req.params as { name: string };
    const { force } = req.query as { force: boolean };
    await need(ctx, req, "policy:Manage", resource.policy(name));
    const p = await find(name);
    if (p.builtin) throw conflict("builtin_policy", "A built-in policy cannot be deleted.");
    const used = await attachedTo(p.id);
    if ((used.users.length || used.groups.length) && !force) {
      throw new HttpError(409, "policy_in_use", "The policy is attached; detach it or delete it with force.", { users: used.users.length, groups: used.groups.length });
    }
    await db.deleteFrom("policies").where("id", "=", p.id).execute();
    await audit(db, { actor: actor(req), action: "policy.deleted", resource: resource.policy(name), outcome: "success", ip: req.ip, details: { users: used.users.length, groups: used.groups.length } });
    return { ok: true };
  });

  /** What the policies of a person decide for one action on one resource, and which statement decided it. Policies only: ownership and shares of a project are not counted. */
  app.post("/api/policies/simulate", {
    schema: { body: { type: "object", required: ["userId", "action", "resource"], additionalProperties: false, properties: { userId: { type: "string", format: "uuid" }, action: { type: "string", maxLength: 64 }, resource: { type: "string", maxLength: 300 } } } },
  }, async (req) => {
    await need(ctx, req, "policy:Manage", resource.policy("*"));
    const { userId, action, resource: res } = req.body as { userId: string; action: string; resource: string };
    if (!(action in ACTIONS)) throw badRequest("unknown_action", `No such action: ${action}.`);
    if (!(await db.selectFrom("users").select("id").where("id", "=", userId).executeTakeFirst())) throw notFound("No such user.");
    const decision = evaluate(await statementsFor(db, userId), { action, resource: res });
    return { allowed: decision.allowed, reason: decision.reason, ...("sid" in decision && decision.sid ? { sid: decision.sid } : {}) };
  });
}

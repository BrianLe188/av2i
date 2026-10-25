import { ADMINISTRATOR, resource } from "@av2i/authz";
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { requireAnotherAdministrator } from "../access.ts";
import { audit } from "../audit.ts";
import { checkNewPassword, hashPassword, temporaryPassword } from "../auth/password.ts";
import { revokeUserSessions } from "../auth/sessions.ts";
import { authOf, need, type Ctx } from "../context.ts";
import { badRequest, conflict, notFound } from "../errors.ts";

const USERNAME = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const idParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;

export function userRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  const view = (u: { id: string; username: string; display_name: string; disabled: boolean; must_change_password: boolean; last_login_at: Date | null; created_at: Date }, policies: string[], groups: string[] = []) => ({
    id: u.id, username: u.username, displayName: u.display_name, disabled: u.disabled, mustChangePassword: u.must_change_password,
    lastLoginAt: u.last_login_at, createdAt: u.created_at, policies, groups,
  });
  const groupsOf = async (userIds: string[]) => {
    const rows = userIds.length
      ? await db.selectFrom("group_members as m").innerJoin("groups as g", "g.id", "m.group_id").select(["m.user_id", "g.name"]).where("m.user_id", "in", userIds).orderBy("g.name").execute()
      : [];
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.user_id, [...(out.get(r.user_id) ?? []), r.name]);
    return out;
  };
  const policiesOf = async (userIds: string[]) => {
    const rows = userIds.length
      ? await db.selectFrom("policy_attachments as pa").innerJoin("policies as p", "p.id", "pa.policy_id").select(["pa.user_id", "p.name"]).where("pa.user_id", "in", userIds).orderBy("p.name").execute()
      : [];
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.user_id!, [...(out.get(r.user_id!) ?? []), r.name]);
    return out;
  };
  const find = async (id: string) => {
    const u = await db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
    if (!u) throw notFound("No such user.");
    return u;
  };
  const actor = (req: Parameters<typeof authOf>[0]) => {
    const s = authOf(req).session;
    return { userId: s.userId, username: s.username };
  };

  app.get("/api/users", async (req) => {
    await need(ctx, req, "user:List", resource.user("*"));
    const users = await db.selectFrom("users").selectAll().orderBy("username").execute();
    const pol = await policiesOf(users.map((u) => u.id));
    const grp = await groupsOf(users.map((u) => u.id));
    return { users: users.map((u) => view(u, pol.get(u.id) ?? [], grp.get(u.id) ?? [])) };
  });

  app.get("/api/users/:id", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    await need(ctx, req, "user:Read", resource.user(id));
    const u = await find(id);
    return { user: view(u, (await policiesOf([id])).get(id) ?? []) };
  });

  app.post("/api/users", {
    schema: { body: { type: "object", required: ["username"], additionalProperties: false, properties: { username: { type: "string", maxLength: 64 }, displayName: { type: "string", maxLength: 120 }, password: { type: "string", maxLength: 256 } } } },
  }, async (req, reply) => {
    await need(ctx, req, "user:Create", resource.user("*"));
    const body = req.body as { username: string; displayName?: string; password?: string };
    const username = body.username.trim().toLowerCase();
    if (!USERNAME.test(username)) throw badRequest("invalid_username", "A username is 2 to 64 letters, digits, dots, dashes or underscores, and starts with a letter or digit.");
    if (body.password !== undefined) {
      const problem = checkNewPassword(body.password, username);
      if (problem) throw badRequest(problem, "That password is not allowed.", { problem });
    }
    const password = body.password ?? temporaryPassword();
    const taken = await db.selectFrom("users").select("id").where("username", "=", username).executeTakeFirst();
    if (taken) throw conflict("username_taken", "That username is taken.");
    const created = await db.insertInto("users").values({
      username, display_name: body.displayName?.trim() ?? "", password_hash: await hashPassword(password), must_change_password: true, created_by: authOf(req).session.userId,
    }).returningAll().executeTakeFirstOrThrow();
    await audit(db, { actor: actor(req), action: "user.created", resource: resource.user(created.id), outcome: "success", ip: req.ip, details: { username } });
    reply.code(201);
    return { user: view(created, []), ...(body.password === undefined ? { temporaryPassword: password } : {}) };
  });

  app.patch("/api/users/:id", {
    schema: { params: idParams, body: { type: "object", additionalProperties: false, minProperties: 1, properties: { displayName: { type: "string", maxLength: 120 }, disabled: { type: "boolean" } } } },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { displayName?: string; disabled?: boolean };
    const user = await find(id);
    if (body.displayName !== undefined) await need(ctx, req, "user:Update", resource.user(id));
    if (body.disabled !== undefined) {
      await need(ctx, req, "user:Disable", resource.user(id));
      if (body.disabled && id === authOf(req).session.userId) throw badRequest("cannot_disable_self", "You cannot disable your own account.");
      if (body.disabled && !user.disabled) await requireAnotherAdministrator(db, id);
    }
    const updated = await db.updateTable("users").set({
      ...(body.displayName !== undefined ? { display_name: body.displayName.trim() } : {}),
      ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
      updated_at: new Date(),
    }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
    if (body.disabled) await revokeUserSessions(db, id);
    const what = body.disabled === undefined ? "user.updated" : body.disabled ? "user.disabled" : "user.enabled";
    await audit(db, { actor: actor(req), action: what, resource: resource.user(id), outcome: "success", ip: req.ip, details: { username: user.username } });
    return { user: view(updated, (await policiesOf([id])).get(id) ?? []) };
  });

  app.post("/api/users/:id/reset-password", {
    schema: { params: idParams, body: { type: ["object", "null"], additionalProperties: false, properties: { password: { type: "string", maxLength: 256 } } } },
  }, async (req) => {
    const { id } = req.params as { id: string };
    await need(ctx, req, "user:ResetPassword", resource.user(id));
    const user = await find(id);
    const given = (req.body as { password?: string } | null)?.password;
    if (given !== undefined) {
      const problem = checkNewPassword(given, user.username);
      if (problem) throw badRequest(problem, "That password is not allowed.", { problem });
    }
    const password = given ?? temporaryPassword();
    await db.updateTable("users").set({ password_hash: await hashPassword(password), must_change_password: true, failed_attempts: 0, locked_until: null, updated_at: new Date() }).where("id", "=", id).execute();
    await db.deleteFrom("login_throttle").where("key", "=", `u:${user.username.toLowerCase()}`).execute();
    await revokeUserSessions(db, id);
    await audit(db, { actor: actor(req), action: "user.password_reset", resource: resource.user(id), outcome: "success", ip: req.ip, details: { username: user.username } });
    return given === undefined ? { temporaryPassword: password } : { ok: true };
  });

  app.put("/api/users/:id/policies", {
    schema: { params: idParams, body: { type: "object", required: ["policies"], additionalProperties: false, properties: { policies: { type: "array", maxItems: 50, items: { type: "string", maxLength: 64 } } } } },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const wanted = [...new Set((req.body as { policies: string[] }).policies)];
    await need(ctx, req, "user:Update", resource.user(id));
    const user = await find(id);
    const known = await db.selectFrom("policies").select(["id", "name"]).execute();
    const byName = new Map(known.map((p) => [p.name.toLowerCase(), p]));
    const chosen = wanted.map((n) => byName.get(n.toLowerCase()) ?? null);
    const missing = wanted.filter((_, i) => !chosen[i]);
    if (missing.length) throw badRequest("unknown_policy", `No such policy: ${missing.join(", ")}.`);
    const current = (await policiesOf([id])).get(id) ?? [];
    const next = chosen.map((c) => c!.name);
    const added = next.filter((n) => !current.includes(n));
    const removed = current.filter((n) => !next.includes(n));
    for (const name of [...added, ...removed]) await need(ctx, req, "policy:Manage", resource.policy(name));
    if (removed.includes(ADMINISTRATOR) && !user.disabled) await requireAnotherAdministrator(db, id);
    await db.transaction().execute(async (trx) => {
      await sql`delete from policy_attachments where user_id = ${id}::uuid`.execute(trx);
      for (const c of chosen) await trx.insertInto("policy_attachments").values({ policy_id: c!.id, user_id: id, group_id: null }).execute();
    });
    await audit(db, { actor: actor(req), action: "user.policies_set", resource: resource.user(id), outcome: "success", ip: req.ip, details: { username: user.username, added, removed } });
    return { policies: next };
  });

  app.get("/api/audit", {
    schema: { querystring: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 500, default: 100 }, before: { type: "string", pattern: "^[0-9]+$" } } } },
  }, async (req) => {
    await need(ctx, req, "audit:Read", resource.audit());
    const q = req.query as { limit: number; before?: string };
    let query = db.selectFrom("audit_log").selectAll().orderBy("id", "desc").limit(q.limit);
    if (q.before) query = query.where("id", "<", q.before);
    const rows = await query.execute();
    return { entries: rows.map((r) => ({ id: r.id, at: r.at, actor: r.actor_username, action: r.action, resource: r.resource, outcome: r.outcome, ip: r.ip, details: r.details })) };
  });
}

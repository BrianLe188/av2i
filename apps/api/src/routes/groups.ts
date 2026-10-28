import { ADMINISTRATOR, resource } from "@av2i/authz";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "kysely";
import { keepingAnAdministrator } from "../access.ts";
import { directSummaries } from "../permissions.ts";
import { audit } from "../audit.ts";
import { authOf, need, type Ctx } from "../context.ts";
import { badRequest, conflict, notFound } from "../errors.ts";

const NAME = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const idParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;

export function groupRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const actor = (req: FastifyRequest) => {
    const s = authOf(req).session;
    return { userId: s.userId, username: s.username };
  };
  const find = async (id: string) => {
    const g = await db.selectFrom("groups").selectAll().where("id", "=", id).executeTakeFirst();
    if (!g) throw notFound("No such group.");
    return g;
  };
  const policiesOf = async (ids: string[]) => {
    const rows = ids.length
      ? await db.selectFrom("policy_attachments as pa").innerJoin("policies as p", "p.id", "pa.policy_id").select(["pa.group_id", "p.name"]).where("pa.group_id", "in", ids).orderBy("p.name").execute()
      : [];
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.group_id!, [...(out.get(r.group_id!) ?? []), r.name]);
    return out;
  };

  app.get("/api/groups", async (req) => {
    await need(ctx, req, "group:Manage", resource.group("*"));
    const groups = await db.selectFrom("groups").selectAll().orderBy("name").execute();
    const counts = await db.selectFrom("group_members").select(["group_id", sql<number>`count(*)`.as("n")]).groupBy("group_id").execute();
    const pol = await policiesOf(groups.map((g) => g.id));
    const direct = await directSummaries(db, "group", groups.map((g) => g.id));
    return { groups: groups.map((g) => ({ id: g.id, name: g.name, description: g.description, createdAt: g.created_at, members: Number(counts.find((c) => c.group_id === g.id)?.n ?? 0), policies: pol.get(g.id) ?? [], direct: direct.get(g.id) ?? { all: false, count: 0 } })) };
  });

  app.post("/api/groups", {
    schema: { body: { type: "object", required: ["name"], additionalProperties: false, properties: { name: { type: "string", maxLength: 64 }, description: { type: "string", maxLength: 300 } } } },
  }, async (req, reply) => {
    await need(ctx, req, "group:Manage", resource.group("*"));
    const body = req.body as { name: string; description?: string };
    const name = body.name.trim().toLowerCase();
    if (!NAME.test(name)) throw badRequest("invalid_group_name", "A group name is 2 to 64 letters, digits, dots, dashes or underscores, and starts with a letter or digit.");
    if (await db.selectFrom("groups").select("id").where("name", "=", name).executeTakeFirst()) throw conflict("group_taken", "That group name is taken.");
    const g = await db.insertInto("groups").values({ name, description: body.description?.trim() ?? "" }).returningAll().executeTakeFirstOrThrow();
    await audit(db, { actor: actor(req), action: "group.created", resource: resource.group(g.id), outcome: "success", ip: req.ip, details: { name } });
    reply.code(201);
    return { group: { id: g.id, name: g.name, description: g.description, members: 0, policies: [] } };
  });

  app.get("/api/groups/:id", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    await need(ctx, req, "group:Manage", resource.group(id));
    const g = await find(id);
    const members = await db.selectFrom("group_members as m").innerJoin("users as u", "u.id", "m.user_id").select(["u.id", "u.username", "u.display_name", "u.disabled"]).where("m.group_id", "=", id).orderBy("u.username").execute();
    return {
      group: { id: g.id, name: g.name, description: g.description, createdAt: g.created_at },
      members: members.map((m) => ({ id: m.id, username: m.username, displayName: m.display_name, disabled: m.disabled })),
      policies: (await policiesOf([id])).get(id) ?? [],
    };
  });

  app.patch("/api/groups/:id", {
    schema: { params: idParams, body: { type: "object", additionalProperties: false, minProperties: 1, properties: { description: { type: "string", maxLength: 300 } } } },
  }, async (req) => {
    const { id } = req.params as { id: string };
    await need(ctx, req, "group:Manage", resource.group(id));
    const g = await find(id);
    const description = (req.body as { description: string }).description.trim();
    await db.updateTable("groups").set({ description }).where("id", "=", id).execute();
    await audit(db, { actor: actor(req), action: "group.updated", resource: resource.group(id), outcome: "success", ip: req.ip, details: { name: g.name } });
    return { ok: true };
  });

  app.delete("/api/groups/:id", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    await need(ctx, req, "group:Manage", resource.group(id));
    const g = await find(id);
    await keepingAnAdministrator(db, async (trx) => { await trx.deleteFrom("groups").where("id", "=", id).execute(); });
    await audit(db, { actor: actor(req), action: "group.deleted", resource: resource.group(id), outcome: "success", ip: req.ip, details: { name: g.name } });
    return { ok: true };
  });

  app.put("/api/groups/:id/members", {
    schema: { params: idParams, body: { type: "object", required: ["userIds"], additionalProperties: false, properties: { userIds: { type: "array", maxItems: 1000, items: { type: "string", format: "uuid" } } } } },
  }, async (req) => {
    const { id } = req.params as { id: string };
    await need(ctx, req, "group:Manage", resource.group(id));
    const g = await find(id);
    const wanted = [...new Set((req.body as { userIds: string[] }).userIds)];
    const known = wanted.length ? await db.selectFrom("users").select("id").where("id", "in", wanted).execute() : [];
    if (known.length !== wanted.length) throw badRequest("unknown_user", "One of the users does not exist.");
    const before = (await db.selectFrom("group_members").select("user_id").where("group_id", "=", id).execute()).map((r) => r.user_id);
    await keepingAnAdministrator(db, async (trx) => {
      await trx.deleteFrom("group_members").where("group_id", "=", id).execute();
      for (const userId of wanted) await trx.insertInto("group_members").values({ group_id: id, user_id: userId }).execute();
    });
    await audit(db, {
      actor: actor(req), action: "group.members_set", resource: resource.group(id), outcome: "success", ip: req.ip,
      details: { name: g.name, added: wanted.filter((u) => !before.includes(u)).length, removed: before.filter((u) => !wanted.includes(u)).length },
    });
    return { members: wanted.length };
  });

  app.put("/api/groups/:id/policies", {
    schema: { params: idParams, body: { type: "object", required: ["policies"], additionalProperties: false, properties: { policies: { type: "array", maxItems: 50, items: { type: "string", maxLength: 64 } } } } },
  }, async (req) => {
    const { id } = req.params as { id: string };
    await need(ctx, req, "group:Manage", resource.group(id));
    const g = await find(id);
    const wanted = [...new Set((req.body as { policies: string[] }).policies)];
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
    await keepingAnAdministrator(db, async (trx) => {
      await trx.deleteFrom("policy_attachments").where("group_id", "=", id).execute();
      for (const c of chosen) await trx.insertInto("policy_attachments").values({ policy_id: c!.id, user_id: null, group_id: id }).execute();
    });
    await audit(db, { actor: actor(req), action: "group.policies_set", resource: resource.group(id), outcome: "success", ip: req.ip, details: { name: g.name, added, removed, administrator: next.includes(ADMINISTRATOR) } });
    return { policies: next };
  });
}

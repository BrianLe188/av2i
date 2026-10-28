import { ACTIONS, documentOf, parseDocument, resource, selectionOf, type Action } from "@av2i/authz";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { audit } from "../audit.ts";
import { authOf, need, sessionOnly, type Ctx } from "../context.ts";
import { notFound } from "../errors.ts";
import { effectivePermissions, sourceFrom, type Source } from "../permissions.ts";

const idParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const choice = {
  type: "object", required: ["all", "actions"], additionalProperties: false,
  properties: { all: { type: "boolean" }, actions: { type: "array", maxItems: Object.keys(ACTIONS).length, items: { type: "string", enum: Object.keys(ACTIONS) } } },
} as const;

/**
 * Permissions given straight to a user or to a group, and the table of what a user or a group may do and why (DD-030). Giving permissions is the
 * same authority as editing policies (`policy:Manage`), and needs a person's session.
 */
export function permissionRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const actor = (req: FastifyRequest) => {
    const s = authOf(req).session;
    return { userId: s.userId, username: s.username };
  };

  const directOf = async (owner: { user: string } | { group: string }) => {
    const q = db.selectFrom("direct_permissions").select("document");
    const row = await ("user" in owner ? q.where("user_id", "=", owner.user) : q.where("group_id", "=", owner.group)).executeTakeFirst();
    if (!row) return { all: false, actions: [] as Action[], document: null as unknown };
    const p = parseDocument(row.document);
    const sel = p.ok ? selectionOf(p.statements) : { ok: false as const, reason: "invalid" };
    return sel.ok ? { all: sel.all, actions: sel.actions, document: row.document } : { all: false, actions: [] as Action[], document: row.document };
  };

  const policySources = async (rows: { name: string; document: unknown; group?: string }[]): Promise<Source[]> => rows.map((r) => sourceFrom("policy", r.name, r.document, r.group));

  /** What a user may do: their policies, what was given to them, and the same through each group they belong to. */
  const userSources = async (id: string): Promise<Source[]> => {
    const own = await db.selectFrom("policy_attachments as pa").innerJoin("policies as p", "p.id", "pa.policy_id").select(["p.name", "p.document"]).where("pa.user_id", "=", id).orderBy("p.name").execute();
    const sources = await policySources(own);
    const direct = await db.selectFrom("direct_permissions").select("document").where("user_id", "=", id).executeTakeFirst();
    if (direct) sources.push(sourceFrom("direct", "", direct.document));
    const groups = await db.selectFrom("group_members as gm").innerJoin("groups as g", "g.id", "gm.group_id").select(["g.id", "g.name"]).where("gm.user_id", "=", id).orderBy("g.name").execute();
    for (const g of groups) {
      const pols = await db.selectFrom("policy_attachments as pa").innerJoin("policies as p", "p.id", "pa.policy_id").select(["p.name", "p.document"]).where("pa.group_id", "=", g.id).orderBy("p.name").execute();
      sources.push(...(await policySources(pols.map((p) => ({ ...p, group: g.name })))));
      const gd = await db.selectFrom("direct_permissions").select("document").where("group_id", "=", g.id).executeTakeFirst();
      if (gd) sources.push(sourceFrom("direct", "", gd.document, g.name));
    }
    return sources;
  };
  const groupSources = async (id: string): Promise<Source[]> => {
    const pols = await db.selectFrom("policy_attachments as pa").innerJoin("policies as p", "p.id", "pa.policy_id").select(["p.name", "p.document"]).where("pa.group_id", "=", id).orderBy("p.name").execute();
    const sources = await policySources(pols);
    const gd = await db.selectFrom("direct_permissions").select("document").where("group_id", "=", id).executeTakeFirst();
    if (gd) sources.push(sourceFrom("direct", "", gd.document));
    return sources;
  };

  const set = async (req: FastifyRequest, owner: { user: string } | { group: string }, name: string, kind: "user" | "group") => {
    await need(ctx, req, "policy:Manage", resource.policy("*"));
    sessionOnly(req);
    const body = req.body as { all: boolean; actions: Action[] };
    const actions = [...new Set(body.actions)];
    const me = actor(req);
    const q = db.deleteFrom("direct_permissions");
    if (!body.all && actions.length === 0) {
      await ("user" in owner ? q.where("user_id", "=", owner.user) : q.where("group_id", "=", owner.group)).execute();
    } else {
      const document = JSON.stringify(documentOf(actions, body.all));
      const existing = await db.selectFrom("direct_permissions").select("id").where(("user" in owner ? "user_id" : "group_id") as "user_id", "=", "user" in owner ? owner.user : owner.group).executeTakeFirst();
      if (existing) await db.updateTable("direct_permissions").set({ document, updated_by: me.userId, updated_at: new Date() }).where("id", "=", existing.id).execute();
      else await db.insertInto("direct_permissions").values({ user_id: "user" in owner ? owner.user : null, group_id: "group" in owner ? owner.group : null, document, updated_by: me.userId }).execute();
    }
    await audit(db, { actor: me, action: `${kind}.direct_permissions_set`, resource: kind === "user" ? resource.user("user" in owner ? owner.user : "") : resource.group("group" in owner ? owner.group : ""), outcome: "success", ip: req.ip, details: { name, all: body.all, actions } });
  };

  app.get("/api/users/:id/permissions", { schema: { params: idParams } }, async (req) => {
    await need(ctx, req, "policy:Manage", resource.policy("*"));
    const { id } = req.params as { id: string };
    if (!(await db.selectFrom("users").select("id").where("id", "=", id).executeTakeFirst())) throw notFound("No such user.");
    const direct = await directOf({ user: id });
    return { direct: { all: direct.all, actions: direct.actions }, effective: effectivePermissions(await userSources(id)) };
  });

  app.put("/api/users/:id/direct-permissions", { schema: { params: idParams, body: choice } }, async (req) => {
    const { id } = req.params as { id: string };
    const u = await db.selectFrom("users").select("username").where("id", "=", id).executeTakeFirst();
    if (!u) throw notFound("No such user.");
    await set(req, { user: id }, u.username, "user");
    return { ok: true };
  });

  app.get("/api/groups/:id/permissions", { schema: { params: idParams } }, async (req) => {
    await need(ctx, req, "policy:Manage", resource.policy("*"));
    const { id } = req.params as { id: string };
    if (!(await db.selectFrom("groups").select("id").where("id", "=", id).executeTakeFirst())) throw notFound("No such group.");
    const direct = await directOf({ group: id });
    return { direct: { all: direct.all, actions: direct.actions }, effective: effectivePermissions(await groupSources(id)) };
  });

  app.put("/api/groups/:id/direct-permissions", { schema: { params: idParams, body: choice } }, async (req) => {
    const { id } = req.params as { id: string };
    const g = await db.selectFrom("groups").select("name").where("id", "=", id).executeTakeFirst();
    if (!g) throw notFound("No such group.");
    await set(req, { group: id }, g.name, "group");
    return { ok: true };
  });

}

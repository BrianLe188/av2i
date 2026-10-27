import { evaluate, ownerStatements, resource, shareStatements, type Action, type ShareRole, type Statement } from "@av2i/authz";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql, type Transaction } from "kysely";
import { audit } from "../audit.ts";
import { authOf, need, type Ctx } from "../context.ts";
import { projectAccess } from "../project-access.ts";
import { checkShape, LIMITS } from "../designs.ts";
import type { Database } from "../schema.ts";
import { badRequest, HttpError, notFound } from "../errors.ts";

/** A save older than this since the last snapshot also leaves a snapshot behind, so history exists without anyone asking for it. */
const AUTO_SNAPSHOT_MS = 10 * 60_000;
const idParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const versionParams = { type: "object", required: ["id", "n"], properties: { id: { type: "string", format: "uuid" }, n: { type: "integer", minimum: 1 } } } as const;
const bigBody = { bodyLimit: LIMITS.bytes };

interface Row {
  id: string;
  name: string;
  owner_id: string;
  rev: number;
  updated_at: Date;
  updated_by: string | null;
}

export function projectRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const { actor, sharesOf, authorize } = projectAccess(ctx);

  const load = async (id: string) => {
    const row = await db.selectFrom("projects").select(["id", "name", "owner_id", "rev", "updated_at", "updated_by"]).where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
    if (!row) throw notFound("No such project.");
    return row as Row;
  };

  const nameOf = async (userId: string | null) => (userId ? (await db.selectFrom("users").select("username").where("id", "=", userId).executeTakeFirst())?.username ?? null : null);

  const summary = (r: Row, owner: string | null, updatedBy: string | null) => ({ id: r.id, name: r.name, owner, ownerId: r.owner_id, rev: r.rev, updatedAt: r.updated_at, updatedBy });

  app.get("/api/projects", async (req) => {
    const auth = authOf(req);
    const policies = await auth.statements();
    const rows = await db
      .selectFrom("projects as p")
      .innerJoin("users as o", "o.id", "p.owner_id")
      .leftJoin("users as u", "u.id", "p.updated_by")
      .select(["p.id", "p.name", "p.owner_id", "p.rev", "p.updated_at", "p.updated_by", "o.username as owner", "u.username as updater",
        sql<number>`jsonb_array_length(p.design->'nodes')`.as("nodes"), sql<number>`jsonb_array_length(p.design->'edges')`.as("edges")])
      .where("p.deleted_at", "is", null)
      .orderBy("p.updated_at", "desc")
      .limit(500)
      .execute();
    const shares = new Map<string, ShareRole[]>();
    for (const s of await sharesOf(auth.session.userId)) shares.set(s.project_id, [...(shares.get(s.project_id) ?? []), s.role as ShareRole]);
    const stated = rows.map((r) => {
      const res = resource.project(r.id);
      const own = r.owner_id === auth.session.userId ? auth.scope(ownerStatements(r.id)) : [];
      const shared = auth.scope((shares.get(r.id) ?? []).flatMap((role) => shareStatements(role, r.id)));
      const all = [...policies, ...own, ...shared];
      // a project that only a policy opens also needs project:List; owning or being shared one is enough by itself
      const visible = evaluate(all, { action: "project:Read", resource: res }).allowed && (own.length > 0 || shared.length > 0 || evaluate(policies, { action: "project:List", resource: res }).allowed);
      return { r, visible, can: { write: evaluate(all, { action: "project:Write", resource: res }).allowed, delete: evaluate(all, { action: "project:Delete", resource: res }).allowed } };
    });
    return { projects: stated.filter((x) => x.visible).map(({ r, can }) => ({ ...summary(r as Row, r.owner, r.updater), nodes: Number(r.nodes), edges: Number(r.edges), can })) };
  });

  app.post("/api/projects", {
    ...bigBody,
    schema: { body: { type: "object", additionalProperties: false, properties: { name: { type: "string", maxLength: LIMITS.name }, design: { type: "object" } } } },
  }, async (req, reply) => {
    await need(ctx, req, "project:Create", resource.project("*"));
    const body = (req.body ?? {}) as { name?: string; design?: Record<string, unknown> };
    const design = body.design ?? { schema: 1, name: body.name?.trim() || "untitled", settings: { region: "ap-southeast-1" }, nodes: [], edges: [] };
    if (body.design && body.name?.trim()) design.name = body.name.trim();
    const shape = checkShape(design);
    if (!shape.ok) throw badRequest("invalid_design", shape.problem);
    const me = actor(req);
    const created = await db.transaction().execute(async (trx) => {
      const row = await trx.insertInto("projects").values({ name: shape.name, owner_id: me.userId, design: JSON.stringify(design), updated_by: me.userId })
        .returning(["id", "name", "owner_id", "rev", "updated_at", "updated_by"]).executeTakeFirstOrThrow();
      await trx.insertInto("project_versions").values({ project_id: row.id, version: 1, design: JSON.stringify(design), auto: true, created_by: me.userId }).execute();
      return row as Row;
    });
    await audit(db, { actor: me, action: "project.created", resource: resource.project(created.id), outcome: "success", ip: req.ip, details: { name: created.name } });
    reply.code(201);
    return { project: summary(created, me.username, me.username) };
  });

  app.get("/api/projects/:id", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const row = await load(id);
    const statements = await authorize(req, row, "project:Read");
    const res = resource.project(id);
    const full = await db.selectFrom("projects").select(["design", "connection_id", "require_approval"]).where("id", "=", id).executeTakeFirstOrThrow();
    const conn = full.connection_id ? await db.selectFrom("aws_connections").select(["id", "name"]).where("id", "=", full.connection_id).executeTakeFirst() : undefined;
    return {
      project: { ...summary(row, await nameOf(row.owner_id), await nameOf(row.updated_by)), design: full.design, connection: conn ?? null, requireApproval: full.require_approval, rescuePending: !!(await db.selectFrom("state_rescues").select("id").where("project_id", "=", id).where("resolved_at", "is", null).executeTakeFirst()) },
      can: {
        write: evaluate(statements, { action: "project:Write", resource: res }).allowed,
        delete: evaluate(statements, { action: "project:Delete", resource: res }).allowed,
        share: evaluate(statements, { action: "project:Share", resource: res }).allowed,
        plan: evaluate(statements, { action: "run:Plan", resource: res }).allowed,
        variables: evaluate(statements, { action: "variable:Write", resource: res }).allowed,
      },
    };
  });

  app.put("/api/projects/:id", {
    ...bigBody,
    schema: { params: idParams, body: { type: "object", required: ["design", "baseRev"], additionalProperties: false, properties: { design: { type: "object" }, baseRev: { type: "integer", minimum: 1 } } } },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const { design, baseRev } = req.body as { design: Record<string, unknown>; baseRev: number };
    await authorize(req, await load(id), "project:Write");
    const shape = checkShape(design);
    if (!shape.ok) throw badRequest("invalid_design", shape.problem);
    const me = actor(req);
    const result = await db.transaction().execute(async (trx) => {
      const cur = await trx.selectFrom("projects").select(["rev", "updated_at", "updated_by"]).where("id", "=", id).where("deleted_at", "is", null).forUpdate().executeTakeFirst();
      if (!cur) throw notFound("No such project.");
      if (cur.rev !== baseRev) {
        const who = cur.updated_by ? (await trx.selectFrom("users").select("username").where("id", "=", cur.updated_by).executeTakeFirst())?.username ?? null : null;
        throw new HttpError(409, "rev_conflict", "Someone saved this project after you opened it.", { currentRev: cur.rev, updatedAt: cur.updated_at, updatedBy: who });
      }
      const updated = await trx.updateTable("projects")
        .set({ name: shape.name, design: JSON.stringify(design), rev: cur.rev + 1, updated_at: new Date(), updated_by: me.userId })
        .where("id", "=", id).returning(["rev", "updated_at"]).executeTakeFirstOrThrow();
      const last = await trx.selectFrom("project_versions").select("created_at").where("project_id", "=", id).orderBy("version", "desc").limit(1).executeTakeFirst();
      if (!last || Date.now() - last.created_at.getTime() > AUTO_SNAPSHOT_MS) await snapshot(trx, id, JSON.stringify(design), "", true, me.userId);
      return updated;
    });
    return { rev: result.rev, updatedAt: result.updated_at };
  });

  app.delete("/api/projects/:id", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const row = await load(id);
    await authorize(req, row, "project:Delete");
    await db.updateTable("projects").set({ deleted_at: new Date() }).where("id", "=", id).execute();
    await audit(db, { actor: actor(req), action: "project.deleted", resource: resource.project(id), outcome: "success", ip: req.ip, details: { name: row.name } });
    return { ok: true };
  });

  app.get("/api/projects/:id/versions", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    await authorize(req, await load(id), "project:Read");
    const rows = await db.selectFrom("project_versions as v").leftJoin("users as u", "u.id", "v.created_by")
      .select(["v.version", "v.note", "v.auto", "v.created_at", "u.username as by", sql<number>`jsonb_array_length(v.design->'nodes')`.as("nodes")])
      .where("v.project_id", "=", id).orderBy("v.version", "desc").limit(200).execute();
    return { versions: rows.map((v) => ({ version: v.version, note: v.note, auto: v.auto, createdAt: v.created_at, by: v.by, nodes: Number(v.nodes) })) };
  });

  app.post("/api/projects/:id/versions", {
    schema: { params: idParams, body: { type: ["object", "null"], additionalProperties: false, properties: { note: { type: "string", maxLength: 200 } } } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await authorize(req, await load(id), "project:Write");
    const note = ((req.body as { note?: string } | null)?.note ?? "").trim();
    const me = actor(req);
    const version = await db.transaction().execute(async (trx) => {
      const cur = await trx.selectFrom("projects").select("design").where("id", "=", id).where("deleted_at", "is", null).forUpdate().executeTakeFirst();
      if (!cur) throw notFound("No such project.");
      return snapshot(trx, id, JSON.stringify(cur.design), note, false, me.userId);
    });
    await audit(db, { actor: me, action: "project.version_saved", resource: resource.project(id), outcome: "success", ip: req.ip, details: { version, note } });
    reply.code(201);
    return { version };
  });

  app.get("/api/projects/:id/versions/:n", { schema: { params: versionParams } }, async (req) => {
    const { id, n } = req.params as { id: string; n: number };
    await authorize(req, await load(id), "project:Read");
    const v = await db.selectFrom("project_versions").select(["version", "note", "design", "created_at"]).where("project_id", "=", id).where("version", "=", n).executeTakeFirst();
    if (!v) throw notFound("No such version.");
    return { version: v.version, note: v.note, createdAt: v.created_at, design: v.design };
  });

  app.post("/api/projects/:id/versions/:n/restore", { schema: { params: versionParams } }, async (req) => {
    const { id, n } = req.params as { id: string; n: number };
    await authorize(req, await load(id), "project:Write");
    const me = actor(req);
    const result = await db.transaction().execute(async (trx) => {
      const cur = await trx.selectFrom("projects").select(["design", "rev"]).where("id", "=", id).where("deleted_at", "is", null).forUpdate().executeTakeFirst();
      if (!cur) throw notFound("No such project.");
      const v = await trx.selectFrom("project_versions").select("design").where("project_id", "=", id).where("version", "=", n).executeTakeFirst();
      if (!v) throw notFound("No such version.");
      // what is there now is kept as a snapshot first, so a restore can itself be undone
      await snapshot(trx, id, JSON.stringify(cur.design), `before restoring version ${n}`, true, me.userId);
      const shape = checkShape(v.design);
      const updated = await trx.updateTable("projects")
        .set({ design: JSON.stringify(v.design), name: shape.ok ? shape.name : "untitled", rev: cur.rev + 1, updated_at: new Date(), updated_by: me.userId })
        .where("id", "=", id).returning(["rev", "updated_at"]).executeTakeFirstOrThrow();
      return { rev: updated.rev, updatedAt: updated.updated_at, design: v.design };
    });
    await audit(db, { actor: me, action: "project.restored", resource: resource.project(id), outcome: "success", ip: req.ip, details: { version: n } });
    return result;
  });

  const shareParams = { type: "object", required: ["id", "shareId"], properties: { id: { type: "string", format: "uuid" }, shareId: { type: "string", format: "uuid" } } } as const;

  app.get("/api/projects/:id/shares", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const row = await load(id);
    await authorize(req, row, "project:Share");
    const rows = await db.selectFrom("project_shares as s")
      .leftJoin("users as u", "u.id", "s.user_id").leftJoin("groups as g", "g.id", "s.group_id").leftJoin("users as by", "by.id", "s.granted_by")
      .select(["s.id", "s.role", "s.created_at", "u.username as user", "g.name as group", "by.username as by"])
      .where("s.project_id", "=", id).orderBy("s.created_at").execute();
    return {
      owner: await nameOf(row.owner_id),
      shares: rows.map((s) => ({ id: s.id, kind: s.user ? "user" : "group", name: s.user ?? s.group, role: s.role, grantedBy: s.by, createdAt: s.created_at })),
    };
  });

  /** Who can be picked in the share dialog; small installs, so the whole list. */
  app.get("/api/projects/:id/share-targets", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    await authorize(req, await load(id), "project:Share");
    const users = await db.selectFrom("users").select("username").where("disabled", "=", false).orderBy("username").execute();
    const groups = await db.selectFrom("groups").select("name").orderBy("name").execute();
    return { users: users.map((u) => u.username), groups: groups.map((g) => g.name) };
  });

  app.put("/api/projects/:id/shares", {
    schema: {
      params: idParams,
      body: { type: "object", required: ["role"], additionalProperties: false, properties: {
        user: { type: "string", maxLength: 64 }, group: { type: "string", maxLength: 64 }, role: { type: "string", enum: ["viewer", "editor"] },
      } },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { user?: string; group?: string; role: ShareRole };
    const row = await load(id);
    await authorize(req, row, "project:Share");
    if (Boolean(body.user) === Boolean(body.group)) throw badRequest("invalid_share", "Name either a user or a group.");
    const me = actor(req);
    let target: { column: "user_id" | "group_id"; id: string; name: string };
    if (body.user) {
      const u = await db.selectFrom("users").select(["id", "username"]).where("username", "=", body.user).where("disabled", "=", false).executeTakeFirst();
      if (!u) throw badRequest("no_such_user", "No such user.");
      if (u.id === row.owner_id) throw badRequest("owner_share", "The owner already has full access.");
      target = { column: "user_id", id: u.id, name: u.username };
    } else {
      const g = await db.selectFrom("groups").select(["id", "name"]).where("name", "=", body.group!).executeTakeFirst();
      if (!g) throw badRequest("no_such_group", "No such group.");
      target = { column: "group_id", id: g.id, name: g.name };
    }
    const existing = await db.selectFrom("project_shares").select("id").where("project_id", "=", id).where(target.column, "=", target.id).executeTakeFirst();
    const share = existing
      ? await db.updateTable("project_shares").set({ role: body.role, granted_by: me.userId }).where("id", "=", existing.id).returning("id").executeTakeFirstOrThrow()
      : await db.insertInto("project_shares").values({ project_id: id, [target.column]: target.id, role: body.role, granted_by: me.userId }).returning("id").executeTakeFirstOrThrow();
    await audit(db, { actor: me, action: "project.shared", resource: resource.project(id), outcome: "success", ip: req.ip, details: { with: target.name, kind: body.user ? "user" : "group", role: body.role } });
    return { id: share.id };
  });

  app.delete("/api/projects/:id/shares/:shareId", { schema: { params: shareParams } }, async (req) => {
    const { id, shareId } = req.params as { id: string; shareId: string };
    await authorize(req, await load(id), "project:Share");
    const gone = await db.deleteFrom("project_shares").where("id", "=", shareId).where("project_id", "=", id).returning(["user_id", "group_id", "role"]).executeTakeFirst();
    if (!gone) throw notFound("No such share.");
    await audit(db, { actor: actor(req), action: "project.unshared", resource: resource.project(id), outcome: "success", ip: req.ip, details: { role: gone.role, kind: gone.user_id ? "user" : "group" } });
    return { ok: true };
  });
}

/** Adds a snapshot as the next version number; the caller holds the project row locked so two cannot pick the same number. */
async function snapshot(trx: Transaction<Database>, projectId: string, design: string, note: string, auto: boolean, userId: string): Promise<number> {
  const next = await trx.selectFrom("project_versions").select(sql<number>`coalesce(max(version), 0) + 1`.as("n")).where("project_id", "=", projectId).executeTakeFirstOrThrow();
  await trx.insertInto("project_versions").values({ project_id: projectId, version: Number(next.n), design, note, auto, created_by: userId }).execute();
  return Number(next.n);
}

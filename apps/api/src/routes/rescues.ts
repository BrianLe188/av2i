import { resource } from "@av2i/authz";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import { sessionOnly, type Ctx } from "../context.ts";
import { HttpError, notFound } from "../errors.ts";
import { projectAccess } from "../project-access.ts";
import { open, requireKey } from "../runs/crypto.ts";
import { restoreRescue } from "../runs/rescue.ts";

const idParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;

/** What an apply created but could not save to the state (DD-026, section 6): listed, downloaded, restored or dismissed by a person. */
export function rescueRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const { actor, authorize } = projectAccess(ctx);

  const projectOf = async (id: string) => {
    const row = await db.selectFrom("projects").select(["id", "owner_id", "name"]).where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
    if (!row) throw notFound("No such project.");
    return row;
  };
  const rescueOf = async (id: string) => {
    const r = await db.selectFrom("state_rescues").selectAll().where("id", "=", id).executeTakeFirst();
    if (!r) throw notFound("No such rescue.");
    return r;
  };

  app.get("/api/projects/:id/state-rescues", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    await authorize(req, await projectOf(id), "state:Read");
    const rows = await db.selectFrom("state_rescues as r").leftJoin("users as u", "u.id", "r.resolved_by")
      .select(["r.id", "r.run_id", "r.serial", "r.created_at", "r.resolved_at", "r.resolution", "u.username as resolvedBy"]).where("r.project_id", "=", id).orderBy("r.created_at", "desc").execute();
    return { rescues: rows.map((r) => ({ id: r.id, runId: r.run_id, serial: r.serial, createdAt: r.created_at, resolvedAt: r.resolved_at, resolution: r.resolution, resolvedBy: r.resolvedBy })) };
  });

  app.get("/api/state-rescues/:id/download", { schema: { params: idParams } }, async (req, reply) => {
    const r = await rescueOf((req.params as { id: string }).id);
    await authorize(req, await projectOf(r.project_id), "state:Read");
    sessionOnly(req);
    const key = requireKey(config.stateKey);
    await audit(db, { actor: actor(req), action: "state.rescue_downloaded", resource: resource.project(r.project_id), outcome: "success", ip: req.ip, details: { rescue: r.id } });
    return reply.header("content-disposition", `attachment; filename="rescued-${r.id}.tfstate"`).type("application/json").send(open(key, { keyId: r.key_id, nonce: r.nonce, data: r.data }));
  });

  app.post("/api/state-rescues/:id/restore", { schema: { params: idParams } }, async (req) => {
    const r = await rescueOf((req.params as { id: string }).id);
    await authorize(req, await projectOf(r.project_id), "state:Write");
    sessionOnly(req);
    const me = actor(req);
    const out = await restoreRescue(db, requireKey(config.stateKey), r.id, me.userId);
    if (!out.ok) throw new HttpError(409, out.code, out.message);
    await audit(db, { actor: me, action: "state.rescue_restored", resource: resource.project(r.project_id), outcome: "success", ip: req.ip, details: { rescue: r.id, serial: r.serial } });
    return { ok: true };
  });

  app.post("/api/state-rescues/:id/dismiss", {
    schema: { params: idParams, body: { type: "object", required: ["confirmName"], additionalProperties: false, properties: { confirmName: { type: "string", maxLength: 200 } } } },
  }, async (req) => {
    const r = await rescueOf((req.params as { id: string }).id);
    const project = await projectOf(r.project_id);
    await authorize(req, project, "state:Write");
    sessionOnly(req);
    if (r.resolved_at) throw new HttpError(409, "already_resolved", "This rescue was dealt with already.");
    if ((req.body as { confirmName: string }).confirmName !== project.name) throw new HttpError(409, "confirm_required", "Type the project name to dismiss a rescued state.");
    const me = actor(req);
    await db.updateTable("state_rescues").set({ resolved_at: new Date(), resolved_by: me.userId, resolution: "dismissed" }).where("id", "=", r.id).execute();
    await audit(db, { actor: me, action: "state.rescue_dismissed", resource: resource.project(r.project_id), outcome: "success", ip: req.ip, details: { rescue: r.id } });
    return { ok: true };
  });
}

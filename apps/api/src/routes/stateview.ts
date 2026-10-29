import { resource } from "@av2i/authz";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import { sessionOnly, type Ctx } from "../context.ts";
import { badRequest, conflict, notFound } from "../errors.ts";
import { projectAccess } from "../project-access.ts";
import { backendOf, parseBackend } from "../runs/backend.ts";
import { open, requireKey } from "../runs/crypto.ts";
import { diffStates, instancesOf, listOutputs, listResources, summarizeState } from "../runs/stateview.ts";

const idParams = { type: "object", required: ["id", "vid"], properties: { id: { type: "string", format: "uuid" }, vid: { type: "integer", minimum: 1 } } } as const;
const projectParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
/** Versions listed at once: the newest ones; older ones are still kept. */
const LIST = 100;

/**
 * The state the platform keeps, as a person can read it (DD-032): versions, resources and outputs with sensitive values hidden, and the
 * difference between two versions. The clear state is a download for whoever may write state.
 */
export function stateViewRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const { actor, authorize } = projectAccess(ctx);

  const projectOf = async (id: string) => {
    const p = await db.selectFrom("projects").select(["id", "owner_id", "name", "state_backend"]).where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
    if (!p) throw notFound("No such project.");
    return p;
  };
  const versionOf = async (projectId: string, vid: number) => {
    const v = await db.selectFrom("state_versions").selectAll().where("id", "=", vid).where("project_id", "=", projectId).executeTakeFirst();
    if (!v) throw notFound("No such version.");
    return v;
  };
  const stateOf = (v: { key_id: string; nonce: Buffer; data: Buffer }) => open(requireKey(config.stateKey), { keyId: v.key_id, nonce: v.nonce, data: v.data });

  /** Chooses where the state is kept. A project that already has state must move it with a migration (DD-032), so only a project with none can switch here. */
  app.put("/api/projects/:id/state/backend", { schema: { params: projectParams, body: { type: "object", required: ["backend"], properties: { backend: { type: "object" } } } } }, async (req) => {
    const { id } = req.params as { id: string };
    const p = await projectOf(id);
    await authorize(req, p, "state:Write");
    sessionOnly(req);
    const parsed = parseBackend((req.body as { backend: unknown }).backend);
    if (!parsed.ok) throw badRequest("invalid_backend", parsed.message);
    const has = await db.selectFrom("state_versions").select("id").where("project_id", "=", id).limit(1).executeTakeFirst();
    if (has) throw conflict("migration_required", "The project already has state; it has to be moved with a migration.");
    const busy = await db.selectFrom("runs").select("id").where("project_id", "=", id).where("status", "in", ["queued", "running"]).limit(1).executeTakeFirst();
    if (busy) throw conflict("run_active", "A run is queued or running for this project.");
    await db.updateTable("projects").set({ state_backend: parsed.backend.kind === "platform" ? null : JSON.stringify(parsed.backend) }).where("id", "=", id).execute();
    await audit(db, { actor: actor(req), action: "state.backend_set", resource: resource.project(id), outcome: "success", ip: req.ip, details: { kind: parsed.backend.kind } });
    return { backend: parsed.backend };
  });

  app.get("/api/projects/:id/state/versions", { schema: { params: projectParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const p = await projectOf(id);
    await authorize(req, p, "state:Read");
    const rows = await db.selectFrom("state_versions as v").leftJoin("runs as r", "r.id", "v.run_id").leftJoin("users as u", "u.id", "r.created_by")
      .select(["v.id", "v.serial", "v.lineage", "v.run_id", "v.created_at", "v.resources", "v.outputs", "v.bytes", "v.key_id", "v.nonce", "v.data", "r.kind as run_kind", "u.username as by"])
      .where("v.project_id", "=", id).orderBy("v.id", "desc").limit(LIST).execute();
    // an older row has no summary yet: work it out once, here
    const out = [];
    for (const v of rows) {
      let { resources, outputs, bytes } = v;
      if (resources === null || outputs === null || bytes === null) {
        const text = stateOf(v);
        const sum = summarizeState(JSON.parse(text.toString("utf8")), text.length);
        ({ resources, outputs, bytes } = sum);
        await db.updateTable("state_versions").set(sum).where("id", "=", v.id).execute();
      }
      out.push({ id: v.id, serial: v.serial, lineage: v.lineage, runId: v.run_id, runKind: v.run_kind, by: v.by, createdAt: v.created_at, resources, outputs, bytes });
    }
    return { versions: out, backend: backendOf(p.state_backend) };
  });

  app.get("/api/projects/:id/state/versions/:vid", { schema: { params: idParams } }, async (req) => {
    const { id, vid } = req.params as { id: string; vid: number };
    await authorize(req, await projectOf(id), "state:Read");
    const v = await versionOf(id, vid);
    const state = JSON.parse(stateOf(v).toString("utf8"));
    return { version: { id: v.id, serial: v.serial, lineage: v.lineage, createdAt: v.created_at }, resources: listResources(state), outputs: listOutputs(state) };
  });

  app.get("/api/projects/:id/state/versions/:vid/resource", {
    schema: { params: idParams, querystring: { type: "object", required: ["address"], properties: { address: { type: "string", maxLength: 500 } } } },
  }, async (req) => {
    const { id, vid } = req.params as { id: string; vid: number };
    await authorize(req, await projectOf(id), "state:Read");
    const state = JSON.parse(stateOf(await versionOf(id, vid)).toString("utf8"));
    const found = instancesOf(state, (req.query as { address: string }).address);
    if (found.length === 0) throw notFound("No such resource in this version.");
    return { instances: found };
  });

  /** What changed from the version before (or `against`) to this one. */
  app.get("/api/projects/:id/state/versions/:vid/diff", {
    schema: { params: idParams, querystring: { type: "object", properties: { against: { type: "integer", minimum: 1 } } } },
  }, async (req) => {
    const { id, vid } = req.params as { id: string; vid: number };
    await authorize(req, await projectOf(id), "state:Read");
    const to = await versionOf(id, vid);
    const against = (req.query as { against?: number }).against;
    const from = against
      ? await versionOf(id, against)
      : await db.selectFrom("state_versions").selectAll().where("project_id", "=", id).where("id", "<", vid).orderBy("id", "desc").limit(1).executeTakeFirst();
    const before = from ? JSON.parse(stateOf(from).toString("utf8")) : null;
    return { from: from ? { id: from.id, serial: from.serial } : null, to: { id: to.id, serial: to.serial }, ...diffStates(before, JSON.parse(stateOf(to).toString("utf8"))) };
  });

  /** The state as it is, with its secrets: for whoever may write state, in a person's session, and written to the audit log. */
  app.get("/api/projects/:id/state/versions/:vid/download", { schema: { params: idParams } }, async (req, reply) => {
    const { id, vid } = req.params as { id: string; vid: number };
    await authorize(req, await projectOf(id), "state:Write");
    sessionOnly(req);
    const v = await versionOf(id, vid);
    await audit(db, { actor: actor(req), action: "state.downloaded", resource: resource.project(id), outcome: "success", ip: req.ip, details: { version: v.id, serial: v.serial } });
    return reply.header("content-disposition", `attachment; filename="terraform-${v.serial}.tfstate"`).type("application/json").send(stateOf(v));
  });

}

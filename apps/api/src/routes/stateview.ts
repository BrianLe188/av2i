import { resource } from "@av2i/authz";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import { sessionOnly, type Ctx } from "../context.ts";
import { createHash } from "node:crypto";
import { badRequest, conflict, notFound, HttpError } from "../errors.ts";
import { runsHooks } from "./runs.ts";
import { projectAccess } from "../project-access.ts";
import { sessionName } from "../aws.ts";
import { backendOf, parseBackend, s3Policies, type S3Backend } from "../runs/backend.ts";
import { open, requireKey } from "../runs/crypto.ts";
import { diffStates, instancesOf, listOutputs, listResources, summarizeState } from "../runs/stateview.ts";

const idParams = { type: "object", required: ["id", "vid"], properties: { id: { type: "string", format: "uuid" }, vid: { type: "integer", minimum: 0 } } } as const;
const projectParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
/** Versions listed at once: the newest ones; older ones are still kept. */
const LIST = 100;

/**
 * The state the platform keeps, as a person can read it (DD-032): versions, resources and outputs with sensitive values hidden, and the
 * difference between two versions. The clear state is a download for whoever may write state.
 */
export function stateViewRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config, aws } = ctx;
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

  /** Keys for reading S3: the plan role of the project's connection, or the server's own identity when it was told to run as itself. */
  const s3Keys = async (projectId: string, userId: string | null, who: string) => {
    const full = await db.selectFrom("projects").select("connection_id").where("id", "=", projectId).executeTakeFirstOrThrow();
    if (!full.connection_id) {
      if (config.runWithServerIdentity) return undefined;
      throw new HttpError(422, "no_connection", "Choose an AWS connection for this project first.");
    }
    const c = await db.selectFrom("aws_connections").select(["plan_role_arn", "external_id"]).where("id", "=", full.connection_id).executeTakeFirstOrThrow();
    const a = await aws.assume({ roleArn: c.plan_role_arn, externalId: c.external_id, sessionName: sessionName(who, userId ?? projectId) });
    if (!a.ok) throw new HttpError(502, "assume_failed", a.message);
    return a.keys;
  };
  /** The version a viewer call is about: a row of the platform's, or (id 0) the file that is in S3 now. */
  const loaded = async (req: Parameters<typeof actor>[0], p: Awaited<ReturnType<typeof projectOf>>, vid: number) => {
    const b = backendOf(p.state_backend);
    if (b.kind === "s3") {
      if (vid !== 0) throw notFound("Only the current state is read from S3.");
      let got: Awaited<ReturnType<typeof aws.s3Read>>;
      try { got = await aws.s3Read(await s3Keys(p.id, actor(req).userId, actor(req).username), b); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, "s3_failed", e instanceof Error ? e.message : "S3 failed"); }
      if (!got) throw notFound("There is no state file in S3 yet.");
      const state = JSON.parse(got.text) as { serial?: number; lineage?: string };
      return { id: 0, serial: state.serial ?? 0, lineage: state.lineage ?? "", createdAt: got.modifiedAt ?? new Date(), raw: Buffer.from(got.text), state };
    }
    const v = await versionOf(p.id, vid);
    const raw = stateOf(v);
    return { id: v.id, serial: v.serial, lineage: v.lineage, createdAt: v.created_at, raw, state: JSON.parse(raw.toString("utf8")) };
  };

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

  /**
   * Moves the state of a project that has some to another backend, as a run (DD-032): the project name is typed, the project's connection
   * must have an apply role (it writes), and nothing else may be running. The new backend is recorded only once the copy is verified.
   */
  app.post("/api/projects/:id/state/migrate", { schema: { params: projectParams, body: { type: "object", required: ["backend", "confirmName"], properties: { backend: { type: "object" }, confirmName: { type: "string", maxLength: 200 } } } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await projectOf(id);
    await authorize(req, p, "state:Write");
    sessionOnly(req);
    const body = req.body as { backend: unknown; confirmName: string };
    if (body.confirmName !== p.name) throw conflict("confirm_required", "Type the project name to move its state.");
    const parsed = parseBackend(body.backend);
    if (!parsed.ok) throw badRequest("invalid_backend", parsed.message);
    const from = backendOf(p.state_backend);
    if (JSON.stringify(from) === JSON.stringify(parsed.backend)) throw conflict("same_backend", "The state is already kept there.");
    const has = await db.selectFrom("state_versions").select("id").where("project_id", "=", id).limit(1).executeTakeFirst();
    if (from.kind === "platform" && !has) throw conflict("no_state", "The project has no state yet; set the backend instead of moving it.");
    const full = await db.selectFrom("projects").select(["design", "connection_id"]).where("id", "=", id).executeTakeFirstOrThrow();
    if (!full.connection_id && !config.runWithServerIdentity) throw new HttpError(422, "no_connection", "Choose an AWS connection for this project first.");
    if (full.connection_id) {
      const c = await db.selectFrom("aws_connections").select("apply_role_arn").where("id", "=", full.connection_id).executeTakeFirst();
      if (!c?.apply_role_arn) throw new HttpError(422, "plan_only_connection", "Moving state needs a connection with an apply role.");
    }
    const pending = await db.selectFrom("state_rescues").select("id").where("project_id", "=", id).where("resolved_at", "is", null).executeTakeFirst();
    if (pending) throw conflict("rescue_pending", "An apply left a state that was not saved. Restore, download or dismiss it first.");
    const busy = await db.selectFrom("runs").select("id").where("project_id", "=", id).where("status", "in", ["queued", "running"]).limit(1).executeTakeFirst();
    if (busy) throw conflict("run_active", "A run is queued or running for this project.");
    const json = JSON.stringify(full.design);
    const me = actor(req);
    const row = await db.insertInto("runs").values({ project_id: id, kind: "migrate", design: json, design_hash: createHash("sha256").update(json).digest("hex"), created_by: me.userId, error: null, plan_data: null, plan_nonce: null, plan_key_id: null, state_serial: null, state_token_hash: null, connection_id: full.connection_id, migrate_to: JSON.stringify(parsed.backend) }).returning("id").executeTakeFirstOrThrow();
    await audit(db, { actor: me, action: "state.migrate_queued", resource: resource.project(id), outcome: "success", ip: req.ip, details: { run: row.id, from: from.kind, to: parsed.backend.kind } });
    runsHooks.wake?.();
    reply.code(201);
    return { run: { id: row.id } };
  });

  /** Looks at a bucket before it is used: reachable, versioned, the file there; with the policies the roles need. Reads only. */
  app.post("/api/projects/:id/state/check", { schema: { params: projectParams, body: { type: "object", properties: { backend: { type: "object" } } } } }, async (req) => {
    const { id } = req.params as { id: string };
    const p = await projectOf(id);
    await authorize(req, p, "state:Read");
    const given = (req.body as { backend?: unknown } | null)?.backend;
    const parsed = given === undefined ? { ok: true as const, backend: backendOf(p.state_backend) } : parseBackend(given);
    if (!parsed.ok) throw badRequest("invalid_backend", parsed.message);
    if (parsed.backend.kind !== "s3") throw badRequest("not_s3", "Only an S3 backend can be checked.");
    const b: S3Backend = parsed.backend;
    let keys: Awaited<ReturnType<typeof s3Keys>>;
    try { keys = await s3Keys(id, actor(req).userId, actor(req).username); } catch (e) { if (e instanceof HttpError) return { ok: false, access: { ok: false, message: e.message }, policies: s3Policies(b) }; throw e; }
    const result = await aws.s3Check(keys, b);
    return { ok: result.bucket.ok && result.versioning.ok && result.object.ok, access: { ok: true }, ...result, policies: s3Policies(b) };
  });

  app.get("/api/projects/:id/state/versions", { schema: { params: projectParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const p = await projectOf(id);
    await authorize(req, p, "state:Read");
    const backend = backendOf(p.state_backend);
    if (backend.kind === "s3") {
      let cur: Awaited<ReturnType<typeof loaded>> | null = null;
      let problem: string | null = null;
      try { cur = await loaded(req, p, 0); } catch (e) { if (e instanceof HttpError && e.status === 404) cur = null; else problem = e instanceof Error ? e.message : "failed"; }
      const sum = cur ? summarizeState(cur.state, cur.raw.length) : null;
      return { versions: cur && sum ? [{ id: 0, serial: cur.serial, lineage: cur.lineage, runId: null, runKind: null, by: null, createdAt: cur.createdAt, ...sum }] : [], backend, problem };
    }
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
    return { versions: out, backend, problem: null };
  });

  app.get("/api/projects/:id/state/versions/:vid", { schema: { params: idParams } }, async (req) => {
    const { id, vid } = req.params as { id: string; vid: number };
    const p = await projectOf(id);
    await authorize(req, p, "state:Read");
    const v = await loaded(req, p, vid);
    return { version: { id: v.id, serial: v.serial, lineage: v.lineage, createdAt: v.createdAt }, resources: listResources(v.state), outputs: listOutputs(v.state) };
  });

  app.get("/api/projects/:id/state/versions/:vid/resource", {
    schema: { params: idParams, querystring: { type: "object", required: ["address"], properties: { address: { type: "string", maxLength: 500 } } } },
  }, async (req) => {
    const { id, vid } = req.params as { id: string; vid: number };
    const p = await projectOf(id);
    await authorize(req, p, "state:Read");
    const found = instancesOf((await loaded(req, p, vid)).state, (req.query as { address: string }).address);
    if (found.length === 0) throw notFound("No such resource in this version.");
    return { instances: found };
  });

  /** What changed from the version before (or `against`) to this one. */
  app.get("/api/projects/:id/state/versions/:vid/diff", {
    schema: { params: idParams, querystring: { type: "object", properties: { against: { type: "integer", minimum: 1 } } } },
  }, async (req) => {
    const { id, vid } = req.params as { id: string; vid: number };
    const p = await projectOf(id);
    await authorize(req, p, "state:Read");
    // S3 keeps one file; its older versions are in the bucket, not read here
    if (backendOf(p.state_backend).kind === "s3") { const cur = await loaded(req, p, vid); return { from: null, to: { id: 0, serial: cur.serial }, added: [], removed: [], changed: [] }; }
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
    const p = await projectOf(id);
    await authorize(req, p, "state:Write");
    sessionOnly(req);
    const v = await loaded(req, p, vid);
    await audit(db, { actor: actor(req), action: "state.downloaded", resource: resource.project(id), outcome: "success", ip: req.ip, details: { version: v.id, serial: v.serial } });
    return reply.header("content-disposition", `attachment; filename="terraform-${v.serial}.tfstate"`).type("application/json").send(v.raw);
  });

}

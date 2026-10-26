import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Ctx } from "../context.ts";
import { HttpError, notFound, unauthorized } from "../errors.ts";
import { open, requireKey, seal } from "../runs/crypto.ts";

const params = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
/** State of a big design is a few megabytes at most; this leaves room without letting a stray call fill the disk. */
const stateBody = { bodyLimit: 32 * 1024 * 1024 };

export const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();

/** The state of a project as OpenTofu's `http` backend sees it: GET, POST, and the LOCK / UNLOCK methods (DD-023). */
export function stateRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  app.addHttpMethod("LOCK", { hasBody: true });
  app.addHttpMethod("UNLOCK", { hasBody: true });
  const route = { config: { public: true, runAuth: true } };

  /** The tofu process signs in as `run` with a secret made for its run only; it works for that project while the run is running. */
  const guard = async (req: FastifyRequest): Promise<string> => {
    const { id } = req.params as { id: string };
    const m = /^Basic\s+(\S+)$/i.exec(req.headers.authorization ?? "");
    const [user, ...rest] = m ? Buffer.from(m[1]!, "base64").toString("utf8").split(":") : [];
    const secret = rest.join(":");
    if (user !== "run" || !secret) throw unauthorized("invalid_run_token", "State is only for the runs of this platform.");
    const row = await db.selectFrom("runs").select("state_token_hash").where("project_id", "=", id).where("status", "=", "running").where("state_token_hash", "is not", null).execute();
    const given = hashToken(secret);
    if (!row.some((r) => timingSafeEqual(r.state_token_hash!, given))) throw unauthorized("invalid_run_token", "State is only for the runs of this platform.");
    return id;
  };

  app.get("/api/state/:id", { ...route, schema: { params } }, async (req, reply) => {
    const id = await guard(req);
    const key = requireKey(config.stateKey);
    const v = await db.selectFrom("state_versions").selectAll().where("project_id", "=", id).orderBy("id", "desc").limit(1).executeTakeFirst();
    if (!v) throw notFound("No state yet.");
    return reply.type("application/json").send(open(key, { keyId: v.key_id, nonce: v.nonce, data: v.data }));
  });

  app.post("/api/state/:id", { ...route, ...stateBody, schema: { params } }, async (req) => {
    const id = await guard(req);
    const key = requireKey(config.stateKey);
    const lockId = (req.query as { ID?: string }).ID;
    const held = await db.selectFrom("state_locks").select("lock_id").where("project_id", "=", id).executeTakeFirst();
    if (held && held.lock_id !== lockId) throw new HttpError(423, "locked", "The state is locked by another operation.");
    const state = req.body as { serial?: unknown; lineage?: unknown } | null;
    if (!state || typeof state !== "object" || !Number.isInteger(state.serial) || typeof state.lineage !== "string") throw new HttpError(400, "invalid_state", "That is not a state file.");
    const sealed = seal(key, Buffer.from(JSON.stringify(state)));
    const run = await db.selectFrom("runs").select("id").where("project_id", "=", id).where("status", "=", "running").orderBy("started_at", "desc").limit(1).executeTakeFirst();
    await db.insertInto("state_versions").values({ project_id: id, serial: state.serial as number, lineage: state.lineage, key_id: sealed.keyId, nonce: sealed.nonce, data: sealed.data, run_id: run?.id ?? null }).execute();
    return { ok: true };
  });

  app.route({
    method: "LOCK", url: "/api/state/:id", ...route, schema: { params },
    handler: async (req, reply) => {
      const id = await guard(req);
      const info = (req.body ?? {}) as { ID?: string };
      if (typeof info.ID !== "string" || !info.ID) throw new HttpError(400, "invalid_lock", "A lock needs an ID.");
      const inserted = await db.insertInto("state_locks").values({ project_id: id, lock_id: info.ID, info: JSON.stringify(info) }).onConflict((oc) => oc.column("project_id").doNothing()).returning("lock_id").executeTakeFirst();
      if (inserted) return { ok: true };
      const cur = await db.selectFrom("state_locks").select("info").where("project_id", "=", id).executeTakeFirst();
      return reply.code(423).send(cur?.info ?? {});
    },
  });

  app.route({
    method: "UNLOCK", url: "/api/state/:id", ...route, schema: { params },
    handler: async (req) => {
      const id = await guard(req);
      const info = (req.body ?? {}) as { ID?: string };
      const q = db.deleteFrom("state_locks").where("project_id", "=", id);
      await (typeof info.ID === "string" && info.ID ? q.where("lock_id", "=", info.ID) : q).execute();
      return { ok: true };
    },
  });
}

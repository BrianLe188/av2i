import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Ctx } from "../context.ts";
import { HttpError, notFound, unauthorized } from "../errors.ts";
import { open, requireKey, seal } from "../runs/crypto.ts";
import { summarizeState } from "../runs/stateview.ts";

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
  const guard = async (req: FastifyRequest): Promise<{ projectId: string; runId: string; kind: "plan" | "apply" | "migrate" }> => {
    const { id } = req.params as { id: string };
    const m = /^Basic\s+(\S+)$/i.exec(req.headers.authorization ?? "");
    const [user, ...rest] = m ? Buffer.from(m[1]!, "base64").toString("utf8").split(":") : [];
    const secret = rest.join(":");
    if (user !== "run" || !secret) throw unauthorized("invalid_run_token", "State is only for the runs of this platform.");
    const rows = await db.selectFrom("runs").select(["id", "kind", "state_token_hash"]).where("project_id", "=", id).where("status", "=", "running").where("state_token_hash", "is not", null).execute();
    const given = hashToken(secret);
    const run = rows.find((r) => timingSafeEqual(r.state_token_hash!, given));
    if (!run) throw unauthorized("invalid_run_token", "State is only for the runs of this platform.");
    return { projectId: id, runId: run.id, kind: run.kind };
  };

  app.get("/api/state/:id", { ...route, schema: { params } }, async (req, reply) => {
    const { projectId: id } = await guard(req);
    const key = requireKey(config.stateKey);
    const v = await db.selectFrom("state_versions").selectAll().where("project_id", "=", id).orderBy("id", "desc").limit(1).executeTakeFirst();
    if (!v) throw notFound("No state yet.");
    return reply.type("application/json").send(open(key, { keyId: v.key_id, nonce: v.nonce, data: v.data }));
  });

  /**
   * A write is accepted only from an apply, under the lock of that run, and only if it continues the state we hold: same lineage,
   * a higher serial (or the very same state again, which is a retried request). OpenTofu checks this too; the server is the one place
   * that sees every writer (DD-026, section 5).
   */
  app.post("/api/state/:id", { ...route, ...stateBody, schema: { params } }, async (req) => {
    const { projectId: id, runId, kind } = await guard(req);
    if (kind === "plan") throw new HttpError(403, "plan_cannot_write", "A plan never writes state.");
    const key = requireKey(config.stateKey);
    const lockId = (req.query as { ID?: string }).ID;
    const held = await db.selectFrom("state_locks").select(["lock_id", "run_id"]).where("project_id", "=", id).executeTakeFirst();
    if (!held) throw new HttpError(423, "lock_required", "State is written under a lock.");
    if (held.lock_id !== lockId || held.run_id !== runId) throw new HttpError(423, "locked", "The state is locked by another operation.");
    const state = req.body as { serial?: unknown; lineage?: unknown } | null;
    if (!state || typeof state !== "object" || !Number.isInteger(state.serial) || typeof state.lineage !== "string") throw new HttpError(400, "invalid_state", "That is not a state file.");
    const serial = state.serial as number;
    const latest = await db.selectFrom("state_versions").selectAll().where("project_id", "=", id).orderBy("id", "desc").limit(1).executeTakeFirst();
    if (latest) {
      if (latest.lineage !== state.lineage) throw new HttpError(409, "lineage_mismatch", "This state does not continue the stored one (another lineage).");
      if (serial < latest.serial) throw new HttpError(409, "serial_regressed", "This state is older than the stored one.");
      if (serial === latest.serial) {
        const same = open(key, { keyId: latest.key_id, nonce: latest.nonce, data: latest.data }).toString("utf8") === JSON.stringify(state);
        if (same) return { ok: true };
        throw new HttpError(409, "serial_conflict", "A different state with the same serial is stored.");
      }
    }
    const text = JSON.stringify(state);
    const sealed = seal(key, Buffer.from(text));
    const sum = summarizeState(state, Buffer.byteLength(text));
    await db.insertInto("state_versions").values({ project_id: id, serial, lineage: state.lineage, key_id: sealed.keyId, nonce: sealed.nonce, data: sealed.data, run_id: runId, ...sum }).execute();
    return { ok: true };
  });

  app.route({
    method: "LOCK", url: "/api/state/:id", ...route, schema: { params },
    handler: async (req, reply) => {
      const { projectId: id, runId } = await guard(req);
      const info = (req.body ?? {}) as { ID?: string };
      if (typeof info.ID !== "string" || !info.ID) throw new HttpError(400, "invalid_lock", "A lock needs an ID.");
      const inserted = await db.insertInto("state_locks").values({ project_id: id, lock_id: info.ID, info: JSON.stringify(info), run_id: runId }).onConflict((oc) => oc.column("project_id").doNothing()).returning("lock_id").executeTakeFirst();
      if (inserted) return { ok: true };
      const cur = await db.selectFrom("state_locks").select("info").where("project_id", "=", id).executeTakeFirst();
      return reply.code(423).send(cur?.info ?? {});
    },
  });

  app.route({
    method: "UNLOCK", url: "/api/state/:id", ...route, schema: { params },
    handler: async (req) => {
      const { projectId: id } = await guard(req);
      const info = (req.body ?? {}) as { ID?: string };
      const q = db.deleteFrom("state_locks").where("project_id", "=", id);
      await (typeof info.ID === "string" && info.ID ? q.where("lock_id", "=", info.ID) : q).execute();
      return { ok: true };
    },
  });
}

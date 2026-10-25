import { ACTIONS } from "@av2i/authz";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { audit } from "../audit.ts";
import { hashToken } from "../auth/sessions.ts";
import { MAX_ACTIVE_TOKENS, newSecret } from "../auth/tokens.ts";
import { sessionOnly, type Ctx } from "../context.ts";
import { badRequest, conflict, notFound } from "../errors.ts";

const idParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const KNOWN = Object.keys(ACTIONS);
const MAX_DAYS = 730;

/** A person's own API tokens. They are made and revoked with a password session only, never with a token. */
export function tokenRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const actor = (req: FastifyRequest) => {
    const s = sessionOnly(req).session;
    return { userId: s.userId, username: s.username };
  };

  app.get("/api/tokens", async (req) => {
    const me = actor(req);
    const rows = await db.selectFrom("api_tokens").select(["id", "name", "prefix", "actions", "expires_at", "last_used_at", "last_used_ip", "revoked_at", "created_at"])
      .where("user_id", "=", me.userId).orderBy("created_at", "desc").limit(200).execute();
    const now = Date.now();
    return {
      tokens: rows.map((t) => ({
        id: t.id, name: t.name, prefix: t.prefix, actions: t.actions, createdAt: t.created_at, expiresAt: t.expires_at, lastUsedAt: t.last_used_at, lastUsedIp: t.last_used_ip,
        status: t.revoked_at ? "revoked" : t.expires_at && t.expires_at.getTime() <= now ? "expired" : "active",
      })),
    };
  });

  app.post("/api/tokens", {
    schema: {
      body: { type: "object", required: ["name"], additionalProperties: false, properties: {
        name: { type: "string", minLength: 1, maxLength: 64 },
        expiresInDays: { type: ["integer", "null"], minimum: 1, maximum: MAX_DAYS },
        actions: { type: ["array", "null"], maxItems: KNOWN.length, items: { type: "string" } },
      } },
    },
  }, async (req, reply) => {
    const me = actor(req);
    const body = req.body as { name: string; expiresInDays?: number | null; actions?: string[] | null };
    const name = body.name.trim();
    if (!name) throw badRequest("invalid_token_name", "Give the token a name.");
    const actions = body.actions ? [...new Set(body.actions)] : null;
    if (actions && (actions.length === 0 || actions.some((a) => !KNOWN.includes(a)))) throw badRequest("invalid_scope", "Pick at least one known action, or none to allow everything you may do.");
    const active = await db.selectFrom("api_tokens").select((eb) => eb.fn.countAll<number>().as("n")).where("user_id", "=", me.userId).where("revoked_at", "is", null)
      .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", new Date())])).executeTakeFirstOrThrow();
    if (Number(active.n) >= MAX_ACTIVE_TOKENS) throw conflict("too_many_tokens", `You already have ${MAX_ACTIVE_TOKENS} active tokens; revoke one first.`);
    const { secret, prefix } = newSecret();
    const expiresAt = body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null;
    const row = await db.insertInto("api_tokens").values({ user_id: me.userId, name, token_hash: hashToken(secret), prefix, actions, expires_at: expiresAt })
      .returning(["id", "created_at"]).executeTakeFirstOrThrow();
    await audit(db, { actor: me, action: "token.created", resource: `av2i:token/${row.id}`, outcome: "success", ip: req.ip, details: { name, prefix, scoped: actions !== null, expires: expiresAt?.toISOString() ?? null } });
    reply.code(201);
    // the only time the secret leaves the server
    return { token: { id: row.id, name, prefix, actions, createdAt: row.created_at, expiresAt, lastUsedAt: null, lastUsedIp: null, status: "active" }, secret };
  });

  app.delete("/api/tokens/:id", { schema: { params: idParams } }, async (req) => {
    const me = actor(req);
    const { id } = req.params as { id: string };
    const row = await db.updateTable("api_tokens").set({ revoked_at: new Date() }).where("id", "=", id).where("user_id", "=", me.userId).where("revoked_at", "is", null)
      .returning(["name", "prefix"]).executeTakeFirst();
    if (!row) throw notFound("No such token.");
    await audit(db, { actor: me, action: "token.revoked", resource: `av2i:token/${id}`, outcome: "success", ip: req.ip, details: { name: row.name, prefix: row.prefix } });
    return { ok: true };
  });
}

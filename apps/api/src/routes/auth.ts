import { allowedActions } from "@av2i/authz";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import { burnVerify, checkNewPassword, hashPassword, verifyPassword } from "../auth/password.ts";
import { createSession, revokeSession, revokeUserSessions, type SessionUser } from "../auth/sessions.ts";
import { clearUser, recordFailure, retryAfter } from "../auth/throttle.ts";
import { authOf, clearSessionCookie, makeAuth, setSessionCookie, type Ctx } from "../context.ts";
import { badRequest, HttpError, unauthorized } from "../errors.ts";

const MAX_FAILED = 10;
const LOCK_MS = 15 * 60_000;

async function me(ctx: Ctx, s: SessionUser) {
  const actions = s.mustChangePassword ? [] : allowedActions(await makeAuth(ctx, s).statements());
  return { user: { id: s.userId, username: s.username, displayName: s.displayName, mustChangePassword: s.mustChangePassword }, actions };
}

export function authRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;

  app.post("/api/auth/login", {
    config: { public: true },
    schema: { body: { type: "object", required: ["username", "password"], additionalProperties: false, properties: { username: { type: "string", minLength: 1, maxLength: 64 }, password: { type: "string", minLength: 1, maxLength: 1024 } } } },
  }, async (req, reply) => {
    const { username: rawName, password } = req.body as { username: string; password: string };
    const username = rawName.trim();
    const keys = { username, ip: req.ip };
    const wait = await retryAfter(db, keys);
    if (wait > 0) {
      await audit(db, { actorName: username, action: "auth.login", outcome: "denied", ip: req.ip, details: { reason: "throttled" } });
      reply.header("Retry-After", String(wait));
      throw new HttpError(429, "too_many_attempts", "Too many attempts. Try again later.", { retryAfter: wait });
    }

    const user = await db.selectFrom("users").selectAll().where("username", "=", username).executeTakeFirst();
    const locked = !!user?.locked_until && user.locked_until.getTime() > Date.now();
    let ok = false;
    if (!user || user.disabled || locked) await burnVerify(password);
    else ok = await verifyPassword(user.password_hash, password);

    if (!ok || !user) {
      await recordFailure(db, keys);
      if (user && !user.disabled && !locked) {
        const failed = user.failed_attempts + 1;
        await db.updateTable("users").set({ failed_attempts: failed, ...(failed >= MAX_FAILED ? { locked_until: new Date(Date.now() + LOCK_MS), failed_attempts: 0 } : {}) }).where("id", "=", user.id).execute();
      }
      await audit(db, { actorName: username, action: "auth.login", outcome: "failure", ip: req.ip, details: { reason: "invalid_credentials" } });
      // the same answer whether the name exists, the password is wrong, or the account is disabled or locked
      throw unauthorized("invalid_credentials", "Wrong username or password.");
    }

    await clearUser(db, username);
    await db.updateTable("users").set({ failed_attempts: 0, locked_until: null, last_login_at: new Date() }).where("id", "=", user.id).execute();
    const session = await createSession(db, config, user.id, { ip: req.ip, userAgent: req.headers["user-agent"] });
    setSessionCookie(req, reply, session.token, session.expiresAt);
    await audit(db, { actor: { userId: user.id, username: user.username }, action: "auth.login", outcome: "success", ip: req.ip });
    return me(ctx, { sessionId: "", userId: user.id, username: user.username, displayName: user.display_name, mustChangePassword: user.must_change_password });
  });

  app.post("/api/auth/logout", { config: { allowMustChange: true } }, async (req, reply) => {
    const { session } = authOf(req);
    await revokeSession(db, session.sessionId);
    clearSessionCookie(reply);
    await audit(db, { actor: { userId: session.userId, username: session.username }, action: "auth.logout", outcome: "success", ip: req.ip });
    return { ok: true };
  });

  app.get("/api/auth/me", { config: { allowMustChange: true } }, async (req) => me(ctx, authOf(req).session));

  app.post("/api/auth/change-password", {
    config: { allowMustChange: true },
    schema: { body: { type: "object", required: ["currentPassword", "newPassword"], additionalProperties: false, properties: { currentPassword: { type: "string", minLength: 1, maxLength: 1024 }, newPassword: { type: "string", minLength: 1, maxLength: 1024 } } } },
  }, async (req, reply) => {
    const { session } = authOf(req);
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    const keys = { username: session.username, ip: req.ip };
    const wait = await retryAfter(db, keys);
    if (wait > 0) {
      reply.header("Retry-After", String(wait));
      throw new HttpError(429, "too_many_attempts", "Too many attempts. Try again later.", { retryAfter: wait });
    }
    const user = await db.selectFrom("users").select(["id", "username", "display_name", "password_hash"]).where("id", "=", session.userId).executeTakeFirstOrThrow();
    if (!(await verifyPassword(user.password_hash, currentPassword))) {
      await recordFailure(db, keys);
      await audit(db, { actor: { userId: user.id, username: user.username }, action: "auth.password_changed", outcome: "failure", ip: req.ip, details: { reason: "wrong_current_password" } });
      throw badRequest("wrong_current_password", "The current password is wrong.");
    }
    const problem = checkNewPassword(newPassword, user.username) ?? (newPassword === currentPassword ? "same_as_old" : null);
    if (problem) throw badRequest(problem, "That password is not allowed.", { problem });

    await db.updateTable("users").set({ password_hash: await hashPassword(newPassword), must_change_password: false, password_changed_at: new Date(), failed_attempts: 0, locked_until: null, updated_at: new Date() }).where("id", "=", user.id).execute();
    await clearUser(db, user.username);
    // every session of the person ends, this one included; a fresh one replaces it
    await revokeUserSessions(db, user.id);
    const next = await createSession(db, config, user.id, { ip: req.ip, userAgent: req.headers["user-agent"] });
    setSessionCookie(req, reply, next.token, next.expiresAt);
    await audit(db, { actor: { userId: user.id, username: user.username }, action: "auth.password_changed", outcome: "success", ip: req.ip });
    return me(ctx, { sessionId: "", userId: user.id, username: user.username, displayName: user.display_name, mustChangePassword: false });
  });
}

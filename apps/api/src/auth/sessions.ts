import { createHash, randomBytes } from "node:crypto";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";

export const COOKIE = "av2i_session";

export const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();

export interface SessionUser {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  mustChangePassword: boolean;
}

export interface Created {
  token: string;
  expiresAt: Date;
}

export async function createSession(db: Db, config: Config, userId: string, meta: { ip?: string; userAgent?: string }): Promise<Created> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = new Date(now + config.sessionMaxHours * 3_600_000);
  await db.insertInto("sessions").values({
    user_id: userId,
    token_hash: hashToken(token),
    idle_expires_at: new Date(Math.min(now + config.sessionIdleMinutes * 60_000, expiresAt.getTime())),
    expires_at: expiresAt,
    ip: meta.ip ?? null,
    user_agent: meta.userAgent?.slice(0, 300) ?? null,
  }).execute();
  return { token, expiresAt };
}

const TOUCH_AFTER_MS = 60_000;

/** The signed-in user behind a cookie token, or null when the session is unknown, revoked, expired or the account is disabled. */
export async function findSession(db: Db, config: Config, token: string): Promise<SessionUser | null> {
  const row = await db
    .selectFrom("sessions as s")
    .innerJoin("users as u", "u.id", "s.user_id")
    .select(["s.id as sessionId", "s.last_seen_at", "s.expires_at", "u.id as userId", "u.username", "u.display_name", "u.must_change_password"])
    .where("s.token_hash", "=", hashToken(token))
    .where("s.revoked_at", "is", null)
    .where("s.expires_at", ">", new Date())
    .where("s.idle_expires_at", ">", new Date())
    .where("u.disabled", "=", false)
    .executeTakeFirst();
  if (!row) return null;
  // slide the idle window, but write at most once a minute
  if (Date.now() - row.last_seen_at.getTime() > TOUCH_AFTER_MS) {
    const idle = Math.min(Date.now() + config.sessionIdleMinutes * 60_000, row.expires_at.getTime());
    await db.updateTable("sessions").set({ last_seen_at: new Date(), idle_expires_at: new Date(idle) }).where("id", "=", row.sessionId).execute();
  }
  return { sessionId: row.sessionId, userId: row.userId, username: row.username, displayName: row.display_name, mustChangePassword: row.must_change_password };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.updateTable("sessions").set({ revoked_at: new Date() }).where("id", "=", sessionId).where("revoked_at", "is", null).execute();
}

/** Revokes every live session of the user, optionally keeping one. */
export async function revokeUserSessions(db: Db, userId: string, except?: string): Promise<void> {
  let q = db.updateTable("sessions").set({ revoked_at: new Date() }).where("user_id", "=", userId).where("revoked_at", "is", null);
  if (except) q = q.where("id", "!=", except);
  await q.execute();
}

export async function purgeSessions(db: Db): Promise<void> {
  await db.deleteFrom("sessions").where("expires_at", "<", new Date(Date.now() - 86_400_000)).execute();
}

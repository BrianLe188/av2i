import { randomBytes } from "node:crypto";
import type { Db } from "../db.ts";
import { hashToken, type SessionUser } from "./sessions.ts";

/** Every secret starts like this, so a leaked one is easy to recognise and to search for. */
export const TOKEN_PREFIX = "av2i_";
export const MAX_ACTIVE_TOKENS = 20;

export const looksLikeToken = (value: string) => value.startsWith(TOKEN_PREFIX);

export function newSecret(): { secret: string; prefix: string } {
  const secret = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { secret, prefix: secret.slice(0, TOKEN_PREFIX.length + 6) };
}

export interface TokenUser extends SessionUser {
  tokenId: string;
  /** the actions the token is limited to, or null for everything the person may do */
  scope: string[] | null;
}

const TOUCH_AFTER_MS = 60_000;

/** The person behind a bearer secret, or null when it is unknown, revoked, expired or the account is disabled. */
export async function findToken(db: Db, secret: string, ip: string): Promise<TokenUser | null> {
  const row = await db
    .selectFrom("api_tokens as t")
    .innerJoin("users as u", "u.id", "t.user_id")
    .select(["t.id as tokenId", "t.actions", "t.last_used_at", "u.id as userId", "u.username", "u.display_name", "u.must_change_password"])
    .where("t.token_hash", "=", hashToken(secret))
    .where("t.revoked_at", "is", null)
    .where((eb) => eb.or([eb("t.expires_at", "is", null), eb("t.expires_at", ">", new Date())]))
    .where("u.disabled", "=", false)
    .executeTakeFirst();
  if (!row) return null;
  // note the use, but write at most once a minute
  if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > TOUCH_AFTER_MS) {
    await db.updateTable("api_tokens").set({ last_used_at: new Date(), last_used_ip: ip }).where("id", "=", row.tokenId).execute();
  }
  return {
    sessionId: "", tokenId: row.tokenId, scope: row.actions,
    userId: row.userId, username: row.username, displayName: row.display_name, mustChangePassword: row.must_change_password,
  };
}

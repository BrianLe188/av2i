import { sql } from "kysely";
import type { Db } from "../db.ts";

const WINDOW_MS = 15 * 60_000;
const LIMITS = { user: 5, ip: 20 } as const;
const MAX_BLOCK_S = 15 * 60;

export interface Keys {
  username: string;
  ip: string;
}

const keysOf = ({ username, ip }: Keys) => [
  { key: `u:${username.toLowerCase()}`, limit: LIMITS.user },
  { key: `ip:${ip}`, limit: LIMITS.ip },
];

/** Seconds to wait before the next attempt, or 0 when attempts are allowed. */
export async function retryAfter(db: Db, k: Keys): Promise<number> {
  const rows = await db.selectFrom("login_throttle").select("blocked_until").where("key", "in", keysOf(k).map((x) => x.key)).execute();
  let wait = 0;
  for (const r of rows) if (r.blocked_until && r.blocked_until.getTime() > Date.now()) wait = Math.max(wait, Math.ceil((r.blocked_until.getTime() - Date.now()) / 1000));
  return wait;
}

/**
 * Counts a failed attempt under the username and under the address. Past the limit the key is blocked for 30 seconds, doubling with
 * each further failure up to 15 minutes. The count starts again when the last window is over.
 */
export async function recordFailure(db: Db, k: Keys): Promise<void> {
  for (const { key, limit } of keysOf(k)) {
    await sql`
      insert into login_throttle (key, attempts, window_start, blocked_until)
      values (${key}, 1, now(), null)
      on conflict (key) do update set
        attempts = case when login_throttle.window_start < now() - ${WINDOW_MS / 1000} * interval '1 second' then 1 else login_throttle.attempts + 1 end,
        window_start = case when login_throttle.window_start < now() - ${WINDOW_MS / 1000} * interval '1 second' then now() else login_throttle.window_start end,
        blocked_until = case
          when login_throttle.window_start < now() - ${WINDOW_MS / 1000} * interval '1 second' then null
          when login_throttle.attempts + 1 >= ${limit}
            then now() + least(${MAX_BLOCK_S}::float8, 30 * power(2, login_throttle.attempts + 1 - ${limit})) * interval '1 second'
          else login_throttle.blocked_until end
    `.execute(db);
  }
}

/** A good sign in clears the username's count (the address keeps its own, so one working account cannot wipe an attacker's). */
export async function clearUser(db: Db, username: string): Promise<void> {
  await db.deleteFrom("login_throttle").where("key", "=", `u:${username.toLowerCase()}`).execute();
}

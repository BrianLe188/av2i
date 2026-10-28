import { ADMINISTRATOR, BUILTIN_POLICIES } from "@av2i/authz";
import { sql } from "kysely";
import { checkNewPassword, hashPassword } from "./auth/password.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";

/** Inserts the built-in policies and brings the ones nobody changed up to date on every start; one that was customized is left as it is. */
export async function syncBuiltinPolicies(db: Db): Promise<void> {
  for (const p of BUILTIN_POLICIES) {
    await sql`
      insert into policies (name, description, document, builtin) values (${p.name}, ${p.description}, ${JSON.stringify(p.document)}::jsonb, true)
      on conflict (name) do update set
        builtin = true,
        description = case when policies.customized then policies.description else excluded.description end,
        document = case when policies.customized then policies.document else excluded.document end,
        updated_at = case when policies.customized then policies.updated_at else now() end
    `.execute(db);
  }
}

export interface Warn {
  warn: (msg: string) => void;
}

/**
 * The first start of an empty installation creates `admin`. Its password is ADMIN_INITIAL_PASSWORD when set, otherwise `admin`.
 * The account must change it at the first sign in, unless the password came from the environment and is already a good one.
 */
export async function ensureAdmin(db: Db, config: Config, log: Warn): Promise<boolean> {
  const existing = await db.selectFrom("users").select("id").limit(1).executeTakeFirst();
  if (existing) return false;
  const fromEnv = config.adminInitialPassword;
  const password = fromEnv ?? "admin";
  const strong = fromEnv !== undefined && checkNewPassword(fromEnv, "admin") === null;
  const user = await db.insertInto("users").values({
    username: "admin",
    display_name: "Administrator",
    password_hash: await hashPassword(password),
    must_change_password: !strong,
    created_by: null,
  }).returning("id").executeTakeFirstOrThrow();
  await sql`insert into policy_attachments (policy_id, user_id) select id, ${user.id}::uuid from policies where name = ${ADMINISTRATOR}`.execute(db);
  if (fromEnv === undefined) log.warn("Created the account `admin` with the password `admin`. Sign in and change it now: nothing else works until you do.");
  else if (!strong) log.warn("Created the account `admin` with the password from ADMIN_INITIAL_PASSWORD, which is too weak to keep: it must be changed at the first sign in.");
  else log.warn("Created the account `admin` with the password from ADMIN_INITIAL_PASSWORD.");
  return true;
}

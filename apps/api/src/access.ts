import { ADMINISTRATOR, parseDocument, type Statement } from "@av2i/authz";
import { sql } from "kysely";
import type { Db } from "./db.ts";
import { conflict } from "./errors.ts";

/** Every statement that applies to a user: the policies attached to them and to the groups they belong to. */
export async function statementsFor(db: Db, userId: string): Promise<Statement[]> {
  const rows = await db
    .selectFrom("policy_attachments as pa")
    .innerJoin("policies as p", "p.id", "pa.policy_id")
    .select("p.document")
    .where((eb) => eb.or([
      eb("pa.user_id", "=", userId),
      eb("pa.group_id", "in", eb.selectFrom("group_members").select("group_id").where("user_id", "=", userId)),
    ]))
    .execute();
  const out: Statement[] = [];
  for (const r of rows) {
    const parsed = parseDocument(r.document);
    if (parsed.ok) out.push(...parsed.statements);
  }
  return out;
}

/** Enabled users that hold `Administrator`, directly or through a group. */
export async function administratorIds(db: Db): Promise<string[]> {
  const res = await sql<{ id: string }>`
    select u.id from users u
    where not u.disabled and exists (
      select 1 from policy_attachments pa join policies p on p.id = pa.policy_id
      where p.name = ${ADMINISTRATOR} and (pa.user_id = u.id or pa.group_id in (select group_id from group_members where user_id = u.id))
    )`.execute(db);
  return res.rows.map((r) => r.id);
}

/** The last administrator cannot be disabled, deleted or stripped of the policy: nobody could sign in to fix it. */
export async function requireAnotherAdministrator(db: Db, userId: string): Promise<void> {
  const ids = await administratorIds(db);
  if (!ids.some((id) => id !== userId)) throw conflict("last_administrator", "This is the last administrator; make someone else an administrator first.");
}

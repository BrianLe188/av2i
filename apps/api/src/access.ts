import { ACTIONS, ADMINISTRATOR_MUST_KEEP, evaluate, parseDocument, type Statement } from "@av2i/authz";
import type { Transaction } from "kysely";
import type { Db } from "./db.ts";
import type { Database } from "./schema.ts";
import { conflict } from "./errors.ts";

/** Every statement that applies to a user: the policies attached to them and to the groups they belong to. */
export async function statementsFor(db: Db | Transaction<Database>, userId: string): Promise<Statement[]> {
  const rows = await db
    .selectFrom("policy_attachments as pa")
    .innerJoin("policies as p", "p.id", "pa.policy_id")
    .select("p.document")
    .where((eb) => eb.or([
      eb("pa.user_id", "=", userId),
      eb("pa.group_id", "in", eb.selectFrom("group_members").select("group_id").where("user_id", "=", userId)),
    ]))
    .execute();
  // what was given to the person or to a group of theirs without a policy (DD-030)
  const direct = await db.selectFrom("direct_permissions").select("document").where((eb) => eb.or([
    eb("user_id", "=", userId),
    eb("group_id", "in", eb.selectFrom("group_members").select("group_id").where("user_id", "=", userId)),
  ])).execute();
  const out: Statement[] = [];
  for (const r of [...rows, ...direct]) {
    const parsed = parseDocument(r.document);
    if (parsed.ok) out.push(...parsed.statements);
  }
  return out;
}

/**
 * Enabled users who can put things right: whose permissions, from policies, groups or given directly, include what manages users and policies
 * (`ADMINISTRATOR_MUST_KEEP`). Reading what people may do, rather than who holds a policy of a certain name, keeps this true however the
 * permissions were given (DD-031).
 */
export async function administratorIds(db: Db | Transaction<Database>): Promise<string[]> {
  const users = await db.selectFrom("users").select("id").where("disabled", "=", false).execute();
  const out: string[] = [];
  for (const u of users) {
    const statements = await statementsFor(db, u.id);
    if (ADMINISTRATOR_MUST_KEEP.every((a) => evaluate(statements, { action: a, resource: ACTIONS[a] }).allowed)) out.push(u.id);
  }
  return out;
}

/** The last administrator cannot be disabled, deleted or stripped of the policy: nobody could sign in to fix it. */
export async function requireAnotherAdministrator(db: Db, userId: string): Promise<void> {
  const ids = await administratorIds(db);
  if (!ids.some((id) => id !== userId)) throw conflict("last_administrator", "This is the last administrator; make someone else an administrator first.");
}

/**
 * Runs a change in a transaction and undoes it if it would leave nobody who can administer: removing a member from the administrators'
 * group, detaching `Administrator` from it, or deleting it. The check reads the result of the change, so every way of losing the last
 * administrator is caught in one place, whatever it went through.
 */
export async function keepingAnAdministrator<T>(db: Db, change: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    const out = await change(trx);
    if ((await administratorIds(trx)).length === 0) throw conflict("last_administrator", "This would leave nobody who can administer; make someone else an administrator first.");
    return out;
  });
}

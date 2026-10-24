import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "kysely";
import type { Db } from "./db.ts";

const dir = join(import.meta.dirname, "..", "migrations");
const LOCK = 7_021_021; // advisory lock key: two processes starting together run the migrations one after the other

/** Applies the numbered SQL files that have not run yet, each in its own transaction. Returns the names it applied. */
export async function migrate(db: Db): Promise<string[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  await db.connection().execute(async (conn) => {
    await sql`select pg_advisory_lock(${LOCK})`.execute(conn);
    try {
      await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`.execute(conn);
      const done = new Set((await sql<{ name: string }>`select name from schema_migrations`.execute(conn)).rows.map((r) => r.name));
      for (const file of files) {
        if (done.has(file)) continue;
        await conn.transaction().execute(async (trx) => {
          await sql.raw(readFileSync(join(dir, file), "utf8")).execute(trx);
          await sql`insert into schema_migrations (name) values (${file})`.execute(trx);
        });
        applied.push(file);
      }
    } finally {
      await sql`select pg_advisory_unlock(${LOCK})`.execute(conn);
    }
  });
  return applied;
}

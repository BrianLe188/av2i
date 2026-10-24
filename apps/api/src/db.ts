import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./schema.ts";

export type Db = Kysely<Database>;

// timestamps come back as Date (the default) and bigint ids as strings, which is what the schema types say
export function createDb(connectionString: string): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 10 }) }) });
}

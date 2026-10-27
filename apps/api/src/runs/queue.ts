import { createHash, randomBytes } from "node:crypto";
import { sql } from "kysely";
import type { Db } from "../db.ts";

const CLAIM_LOCK = 7_021_023; // advisory lock key: two workers claiming together take turns, so one project never gets two runs

export interface Claimed {
  id: string;
  project_id: string;
  kind: "plan" | "apply";
  design: unknown;
  design_hash: string;
  created_by: string | null;
  connection_id: string | null;
  plan_run_id: string | null;
  /** the secret the tofu process presents to the state backend; only its hash is stored */
  token: string;
}

/** Takes the oldest queued run whose project has nothing running, marks it running and gives it its state secret. */
export async function claim(db: Db): Promise<Claimed | null> {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest();
  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(${CLAIM_LOCK})`.execute(trx);
    const row = await trx.updateTable("runs").set({ status: "running", started_at: sql`now()`, state_token_hash: hash })
      .where("id", "=", (eb) => eb.selectFrom("runs as r").select("r.id").where("r.status", "=", "queued")
        .where((e) => e.not(e.exists(e.selectFrom("runs as x").select("x.id").whereRef("x.project_id", "=", "r.project_id").where("x.status", "=", "running"))))
        .orderBy("r.created_at").limit(1).forUpdate().skipLocked())
      .returning(["id", "project_id", "kind", "design", "design_hash", "created_by", "connection_id", "plan_run_id"]).executeTakeFirst();
    return row ? ({ ...row, token } as Claimed) : null;
  });
}

/**
 * A run still marked running when the server starts was cut off by the restart: nothing is working on it. It is marked failed and the
 * state lock its tofu process held is released (the process cannot unlock it any more). Returns how many runs it ended.
 */
export async function failStale(db: Db): Promise<number> {
  return db.transaction().execute(async (trx) => {
    // an apply cut off may have changed AWS without the state following: it is "interrupted", not just failed
    const rows = await trx.updateTable("runs").set({ status: sql`case when kind = 'apply' then 'interrupted' else 'failed' end`, finished_at: sql`now()`, error: sql`case when kind = 'apply' then 'The server restarted while this apply was working. AWS may have changed without the state following: run a plan to see where things stand.' else 'The server restarted while this run was working.' end`, state_token_hash: null })
      .where("status", "=", "running").returning("project_id").execute();
    if (rows.length) await trx.deleteFrom("state_locks").where("project_id", "in", rows.map((r) => r.project_id)).execute();
    return rows.length;
  });
}

export interface Workers {
  stop: () => Promise<void>;
  /** look for work now instead of at the next tick */
  wake: () => void;
}

/** `count` loops that take runs and hand them to `work`; each project still runs one at a time because `claim` skips busy projects. */
export function startWorkers(db: Db, count: number, work: (run: Claimed) => Promise<void>, onError: (e: unknown) => void, pollMs = 1000): Workers {
  let stopped = false;
  const wakers = new Set<() => void>();
  const wake = () => wakers.forEach((w) => w());
  const idle = () => new Promise<void>((resolve) => {
    const t = setTimeout(done, pollMs);
    function done() { clearTimeout(t); wakers.delete(done); resolve(); }
    wakers.add(done);
  });
  const loops = Array.from({ length: count }, async () => {
    while (!stopped) {
      try {
        const run = await claim(db);
        if (!run) { await idle(); continue; }
        await work(run);
      } catch (e) {
        onError(e);
        await idle();
      }
    }
  });
  return { wake, stop: async () => { stopped = true; wake(); await Promise.all(loops); } };
}

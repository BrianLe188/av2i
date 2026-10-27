import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import { open, seal } from "./crypto.ts";

/**
 * What an apply created but OpenTofu could not write to the backend is left by OpenTofu as `errored.tfstate`. It is the only record of
 * those resources, so it is stored sealed before the run's folder is deleted (DD-026, section 6). If the database cannot take it either,
 * it goes sealed to a file next to the runs, and is imported at the next start.
 */
export async function storeRescue(db: Db, config: Config, key: Buffer, found: { projectId: string; runId: string | null; text: string }): Promise<"db" | "file"> {
  let serial = 0;
  let lineage = "";
  try {
    const s = JSON.parse(found.text) as { serial?: number; lineage?: string };
    serial = Number.isInteger(s.serial) ? s.serial! : 0;
    lineage = typeof s.lineage === "string" ? s.lineage : "";
  } catch { /* kept as it is: a file that does not parse is still the only copy */ }
  const sealed = seal(key, Buffer.from(found.text, "utf8"));
  try {
    await db.insertInto("state_rescues").values({ project_id: found.projectId, run_id: found.runId, serial, lineage, key_id: sealed.keyId, nonce: sealed.nonce, data: sealed.data, resolved_by: null, resolution: null }).execute();
    return "db";
  } catch {
    const dir = join(config.runsDir, "rescue");
    mkdirSync(dir, { recursive: true });
    const name = `${found.projectId}__${found.runId ?? "none"}__${Date.now()}.json`;
    writeFileSync(join(dir, name), JSON.stringify({ projectId: found.projectId, runId: found.runId, serial, lineage, keyId: sealed.keyId, nonce: sealed.nonce.toString("base64"), data: sealed.data.toString("base64") }), { mode: 0o600 });
    return "file";
  }
}

export type Restore = { ok: true } | { ok: false; code: "no_such_rescue" | "already_resolved" | "lineage_mismatch" | "serial_not_newer"; message: string };

/** Makes a rescued state the newest version, if it continues the state we hold (same lineage, higher serial). */
export async function restoreRescue(db: Db, key: Buffer, id: string, userId: string): Promise<Restore> {
  const r = await db.selectFrom("state_rescues").selectAll().where("id", "=", id).executeTakeFirst();
  if (!r) return { ok: false, code: "no_such_rescue", message: "No such rescue." };
  if (r.resolved_at) return { ok: false, code: "already_resolved", message: "This rescue was dealt with already." };
  const latest = await db.selectFrom("state_versions").select(["serial", "lineage"]).where("project_id", "=", r.project_id).orderBy("id", "desc").limit(1).executeTakeFirst();
  if (latest && latest.lineage !== r.lineage) return { ok: false, code: "lineage_mismatch", message: "The rescued state has another lineage than the stored one: download it and import by hand." };
  if (latest && r.serial <= latest.serial) return { ok: false, code: "serial_not_newer", message: "The stored state is already as new as the rescued one: download it to compare." };
  const text = open(key, { keyId: r.key_id, nonce: r.nonce, data: r.data });
  await db.transaction().execute(async (trx) => {
    await trx.insertInto("state_versions").values({ project_id: r.project_id, serial: r.serial, lineage: r.lineage, key_id: r.key_id, nonce: r.nonce, data: r.data, run_id: r.run_id }).execute();
    await trx.updateTable("state_rescues").set({ resolved_at: new Date(), resolved_by: userId, resolution: "restored" }).where("id", "=", id).execute();
  });
  void text;
  return { ok: true };
}

/**
 * At start no run can be using a folder: those a cut-off run left behind are removed, but an `errored.tfstate` in one is stored first
 * (the folder is named after its run), and rescues the database could not take are imported from their files. Without the state key
 * nothing with a state in it is deleted. Returns how many folders were removed and how many states were saved.
 */
export async function recoverRunDirs(db: Db, config: Config): Promise<{ removed: number; rescued: number }> {
  const out = { removed: 0, rescued: 0 };
  if (!existsSync(config.runsDir)) return out;
  for (const name of readdirSync(config.runsDir).filter((n) => /^run-/.test(n))) {
    const dir = join(config.runsDir, name);
    const errored = join(dir, "errored.tfstate");
    if (existsSync(errored)) {
      if (!config.stateKey) continue;
      const runId = /^run-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/.exec(name)?.[1] ?? null;
      const run = runId ? await db.selectFrom("runs").select("project_id").where("id", "=", runId).executeTakeFirst() : undefined;
      if (!run) continue;
      await storeRescue(db, config, config.stateKey, { projectId: run.project_id, runId, text: readFileSync(errored, "utf8") });
      out.rescued++;
    }
    rmSync(dir, { recursive: true, force: true });
    out.removed++;
  }
  const spare = join(config.runsDir, "rescue");
  if (existsSync(spare)) {
    for (const f of readdirSync(spare).filter((n) => n.endsWith(".json"))) {
      try {
        const e = JSON.parse(readFileSync(join(spare, f), "utf8")) as { projectId: string; runId: string | null; serial: number; lineage: string; keyId: string; nonce: string; data: string };
        const run = e.runId ? await db.selectFrom("runs").select("id").where("id", "=", e.runId).executeTakeFirst() : undefined;
        await db.insertInto("state_rescues").values({ project_id: e.projectId, run_id: run ? e.runId : null, serial: e.serial, lineage: e.lineage, key_id: e.keyId, nonce: Buffer.from(e.nonce, "base64"), data: Buffer.from(e.data, "base64"), resolved_by: null, resolution: null }).execute();
        rmSync(join(spare, f));
        out.rescued++;
      } catch { /* still not importable: the file stays */ }
    }
  }
  return out;
}

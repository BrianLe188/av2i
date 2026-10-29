import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { s3BackendFile, type StateBackend } from "./backend.ts";

export type Tofu = (cwd: string, title: string, args: string[], capture?: boolean) => Promise<string>;

export interface Moved { serial: number; lineage: string; resources: number }

const parse = (text: string): { serial: number; lineage: string; resources: unknown[] } => {
  const s = JSON.parse(text) as { serial?: unknown; lineage?: unknown; resources?: unknown };
  if (!Number.isInteger(s.serial) || typeof s.lineage !== "string") throw new Error("The state read back is not a state file.");
  return { serial: s.serial as number, lineage: s.lineage, resources: Array.isArray(s.resources) ? s.resources : [] };
};

/**
 * Copies the state from one backend to the other with `state pull` and `state push`, each in a folder of its own that holds only a backend
 * block, and checks the copy by reading it back. The old copy is never touched, so a failure leaves the project where it was (DD-032).
 */
export async function migrateState(o: { from: StateBackend; to: StateBackend; platformBackend: string; work: string; tofu: Tofu; log: (line: string) => void }): Promise<Moved> {
  const folder = (name: string, b: StateBackend, withLock: boolean) => {
    const dir = join(o.work, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "backend.tf"), b.kind === "s3" ? s3BackendFile(b, withLock) : o.platformBackend);
    return dir;
  };
  const from = folder("from", o.from, false), to = folder("to", o.to, true);
  await o.tofu(from, "init (source)", ["init", "-input=false", "-no-color"]);
  const source = (await o.tofu(from, "state pull (source)", ["state", "pull"], true)).trim();
  if (!source) throw new Error("The current backend holds no state to move.");
  const src = parse(source);
  await o.tofu(to, "init (destination)", ["init", "-input=false", "-no-color"]);
  const there = (await o.tofu(to, "state pull (destination)", ["state", "pull"], true)).trim();
  // an empty backend answers with a blank state (serial 0, no lineage), not with nothing
  const held = there ? parse(there) : null;
  const blank = !held || (held.serial === 0 && held.lineage === "" && held.resources.length === 0);
  if (!blank && held) {
    if (held.lineage !== src.lineage) throw new Error("The destination already holds a different state; it was left alone.");
    // a push into a backend bumps the serial, so a copy made by an earlier try of this move is a little ahead of its source
    if (held.serial >= src.serial) o.log("The destination already holds this state; checking it.");
  }
  if (blank || (held && held.serial < src.serial)) {
    writeFileSync(join(to, "moved.tfstate"), source);
    await o.tofu(to, "state push", ["state", "push", "moved.tfstate"]);
    // pushed into an empty backend, OpenTofu starts a lineage of its own: push again over it (nothing else is there) to keep ours
    const after = parse((await o.tofu(to, "state pull (lineage)", ["state", "pull"], true)).trim());
    if (after.lineage !== src.lineage) await o.tofu(to, "state push -force", ["state", "push", "-force", "moved.tfstate"]);
  }
  const back = parse((await o.tofu(to, "state pull (check)", ["state", "pull"], true)).trim());
  if (back.lineage !== src.lineage || back.serial < src.serial || back.resources.length !== src.resources.length) {
    throw new Error("The copy does not match the original (lineage, serial or resources differ); the project keeps its old backend.");
  }
  o.log(`Verified: serial ${back.serial}, ${back.resources.length} resource group(s), same lineage.`);
  return { serial: back.serial, lineage: back.lineage, resources: back.resources.length };
}

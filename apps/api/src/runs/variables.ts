import { createHash } from "node:crypto";
import { variablesOf, type RequiredVariable } from "@av2i/generator";
import type { Design } from "@av2i/model";
import type { Db } from "../db.ts";
import { open, seal } from "./crypto.ts";

/** Names of the shape OpenTofu reads from `TF_VAR_<name>`; the generator only makes such names, this keeps a stray one out of the environment. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const validName = (name: string): boolean => NAME.test(name);

export const requiredOf = (design: Design): RequiredVariable[] => variablesOf(design).filter((v) => validName(v.name));

export interface Stored {
  name: string;
  updatedAt: Date;
  updatedBy: string | null;
}

/** What is stored for a project, without any value. */
export async function storedOf(db: Db, projectId: string): Promise<Stored[]> {
  const rows = await db.selectFrom("project_variables as v").leftJoin("users as u", "u.id", "v.updated_by")
    .select(["v.name", "v.updated_at", "u.username"]).where("v.project_id", "=", projectId).orderBy("v.name").execute();
  return rows.map((r) => ({ name: r.name, updatedAt: r.updated_at, updatedBy: r.username }));
}

export async function setValue(db: Db, key: Buffer, projectId: string, name: string, value: string, userId: string): Promise<void> {
  const s = seal(key, Buffer.from(value, "utf8"));
  await db.insertInto("project_variables").values({ project_id: projectId, name, key_id: s.keyId, nonce: s.nonce, data: s.data, updated_by: userId })
    .onConflict((oc) => oc.columns(["project_id", "name"]).doUpdateSet({ key_id: s.keyId, nonce: s.nonce, data: s.data, updated_by: userId, updated_at: new Date() })).execute();
}

/** The values for `names`, decrypted; a name with no stored value is left out. */
export async function valuesOf(db: Db, key: Buffer, projectId: string, names: string[]): Promise<Record<string, string>> {
  if (!names.length) return {};
  const rows = await db.selectFrom("project_variables").selectAll().where("project_id", "=", projectId).where("name", "in", names).execute();
  return Object.fromEntries(rows.map((r) => [r.name, open(key, { keyId: r.key_id, nonce: r.nonce, data: r.data }).toString("utf8")]));
}

/** Changes whenever a value the design uses is set again or removed; null when the design uses none. */
export function stampOf(required: RequiredVariable[], stored: Stored[]): string | null {
  if (!required.length) return null;
  const by = new Map(stored.map((s) => [s.name, s.updatedAt.getTime()]));
  const text = required.map((r) => r.name).sort().map((n) => `${n}:${by.get(n) ?? "-"}`).join("\n");
  return createHash("sha256").update(text).digest("hex");
}

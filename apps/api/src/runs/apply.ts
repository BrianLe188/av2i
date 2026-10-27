import { createHash } from "node:crypto";
import { generate } from "@av2i/generator";
import { upgradeDesign, type Design } from "@av2i/model";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import { requiredOf, stampOf, storedOf } from "./variables.ts";

/** How long a plan may wait to be applied: the world moves on, and so does the answer of the provider. */
export const PLAN_TTL_MS = 24 * 3600_000;

/**
 * The hash of the Terraform files a design generates (names and contents). It says whether the design changed in a way OpenTofu would
 * notice: moving a box on the canvas does not change it, unlike a hash of the design's JSON, which holds the positions.
 */
export function filesHash(design: Design): string {
  const files = generate(design);
  const text = Object.keys(files).filter((n) => n.endsWith(".tf")).sort().map((n) => `${n}\n${files[n]}`).join("\0");
  return createHash("sha256").update(text).digest("hex");
}

export interface Blocker {
  code: "plan_not_ready" | "already_applied" | "plan_expired" | "design_changed" | "variables_changed" | "connection_changed" | "no_apply_role" | "state_changed" | "rescue_pending" | "not_approved";
  detail?: string;
}

export interface PlanFacts {
  id: string;
  kind: "plan" | "apply";
  status: string;
  hasPlan: boolean;
  finished_at: Date | null;
  files_hash: string | null;
  variables_hash: string | null;
  connection_id: string | null;
  state_serial: number | null;
  created_by: string | null;
  destructive: boolean;
}

export interface ProjectFacts {
  id: string;
  name: string;
  design: unknown;
  connection_id: string | null;
  require_approval: boolean;
}

export interface ApplyState {
  blockers: Blocker[];
  needsApproval: boolean;
  destructive: boolean;
  expiresAt: Date | null;
  approvals: { username: string; at: Date }[];
}

/** Everything that stands between a plan and its apply, as the studio shows it and the server enforces it (DD-026, section 2). */
export async function applyState(db: Db, config: Config, plan: PlanFacts, project: ProjectFacts, now = new Date()): Promise<ApplyState> {
  const blockers: Blocker[] = [];
  const approvals = (await db.selectFrom("run_approvals").select(["username", "at"]).where("run_id", "=", plan.id).orderBy("at").execute());
  const expiresAt = plan.finished_at ? new Date(plan.finished_at.getTime() + PLAN_TTL_MS) : null;
  const state: ApplyState = { blockers, needsApproval: project.require_approval, destructive: plan.destructive, expiresAt, approvals };
  if (plan.kind !== "plan" || plan.status !== "succeeded" || !plan.hasPlan) {
    blockers.push({ code: "plan_not_ready" });
    return state;
  }
  const done = await db.selectFrom("runs").select("id").where("plan_run_id", "=", plan.id).where("kind", "=", "apply").where("status", "in", ["queued", "running", "succeeded"]).executeTakeFirst();
  if (done) blockers.push({ code: "already_applied" });
  if (expiresAt && expiresAt <= now) blockers.push({ code: "plan_expired" });
  const design = upgradeDesign(project.design as Design);
  if (filesHash(design) !== plan.files_hash) blockers.push({ code: "design_changed" });
  if (stampOf(requiredOf(design), await storedOf(db, project.id)) !== plan.variables_hash) blockers.push({ code: "variables_changed" });
  if (plan.connection_id !== project.connection_id) blockers.push({ code: "connection_changed" });
  else if (plan.connection_id) {
    const c = await db.selectFrom("aws_connections").select("apply_role_arn").where("id", "=", plan.connection_id).executeTakeFirst();
    if (!c?.apply_role_arn) blockers.push({ code: "no_apply_role" });
  } else if (!config.runWithServerIdentity) blockers.push({ code: "no_apply_role" });
  const latest = await db.selectFrom("state_versions").select("serial").where("project_id", "=", project.id).orderBy("id", "desc").limit(1).executeTakeFirst();
  if ((latest?.serial ?? null) !== plan.state_serial) blockers.push({ code: "state_changed" });
  const rescue = await db.selectFrom("state_rescues").select("id").where("project_id", "=", project.id).where("resolved_at", "is", null).executeTakeFirst();
  if (rescue) blockers.push({ code: "rescue_pending" });
  if (project.require_approval) {
    const planner = plan.created_by ? (await db.selectFrom("users").select("username").where("id", "=", plan.created_by).executeTakeFirst())?.username : undefined;
    if (!approvals.some((a) => a.username !== planner)) blockers.push({ code: "not_approved" });
  }
  return state;
}

import { createHash } from "node:crypto";
import { evaluate, resource, type Statement } from "@av2i/authz";
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
  code: "plan_not_ready" | "already_applied" | "plan_expired" | "design_changed" | "variables_changed" | "connection_changed" | "no_apply_role" | "state_changed" | "rescue_pending";
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
}

export interface ApplyState {
  blockers: Blocker[];
  destructive: boolean;
  expiresAt: Date | null;
}

/** Everything that stands between a plan and its apply, as the studio shows it and the server enforces it (DD-026, section 2). */
export async function applyState(db: Db, config: Config, plan: PlanFacts, project: ProjectFacts, now = new Date()): Promise<ApplyState> {
  const blockers: Blocker[] = [];
  const expiresAt = plan.finished_at ? new Date(plan.finished_at.getTime() + PLAN_TTL_MS) : null;
  const state: ApplyState = { blockers, destructive: plan.destructive, expiresAt };
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
  return state;
}

export interface RequestFacts {
  id: string;
  status: string;
  requester_id: string | null;
  decided_by_id: string | null;
}

export type ApplyPath = { ok: true; via: "self" | "request" } | { ok: false; code: "destructive_forbidden" | "awaiting_approval" | "request_needed" };

/**
 * Whether this person may press Apply on a plan (DD-027). Someone who may both apply and approve decides for themselves; otherwise the plan needs
 * an approved request, and then the requester, the approver or anyone with run:Apply may apply it. An approved plan that deletes was approved by
 * someone with run:ApplyDestructive, so the one who applies it does not need that right too.
 */
export function applyPath(statements: Statement[], projectId: string, userId: string, request: RequestFacts | null, destructive: boolean): ApplyPath {
  const res = resource.project(projectId);
  const may = (a: "run:Apply" | "run:Approve" | "run:ApplyDestructive") => evaluate(statements, { action: a, resource: res }).allowed;
  const self = may("run:Apply") && may("run:Approve");
  if (self && (!destructive || may("run:ApplyDestructive"))) return { ok: true, via: "self" };
  if (request?.status === "approved" && (request.requester_id === userId || request.decided_by_id === userId || may("run:Apply"))) return { ok: true, via: "request" };
  if (self) return { ok: false, code: "destructive_forbidden" };
  return { ok: false, code: request?.status === "waiting" ? "awaiting_approval" : "request_needed" };
}

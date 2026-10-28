import { evaluate, resource, type Statement } from "@av2i/authz";
import { sql, type Transaction } from "kysely";
import type { Db } from "./db.ts";
import { applyPath, type RequestFacts } from "./runs/apply.ts";
import type { Database } from "./schema.ts";

export interface RequestRow {
  id: string;
  project_id: string;
  number: number;
  kind: "apply";
  plan_run_id: string | null;
  status: "waiting" | "approved" | "applied" | "closed";
  close_reason: "rejected" | "withdrawn" | null;
  requester_id: string | null;
  requester: string;
  decided_by_id: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const LIVE = ["waiting", "approved"] as const;
export type EventKind = Database["request_events"]["kind"];

/** The request that covers a plan right now (waiting for a decision, or approved and not yet applied). */
export async function liveRequestOf(db: Db, planRunId: string): Promise<RequestRow | undefined> {
  return (await db.selectFrom("requests").selectAll().where("plan_run_id", "=", planRunId).where("status", "in", [...LIVE]).executeTakeFirst()) as RequestRow | undefined;
}

export async function addEvent(db: Db | Transaction<Database>, requestId: string, actor: { userId: string | null; username: string }, kind: EventKind, body?: string | null, data: Record<string, unknown> = {}): Promise<void> {
  await db.insertInto("request_events").values({ request_id: requestId, actor_id: actor.userId, actor: actor.username, kind, body: body ?? null, data: JSON.stringify(data) }).execute();
  await db.updateTable("requests").set({ updated_at: new Date() }).where("id", "=", requestId).execute();
}

export interface RequestCan {
  approve: boolean;
  /** the person may decide but the plan deletes or replaces and they lack run:ApplyDestructive */
  approveBlocked: "destructive_forbidden" | null;
  reject: boolean;
  withdraw: boolean;
  replan: boolean;
  apply: boolean;
}

/** What this person may do with a request (DD-027, section 3). The server checks again on every call. */
export function requestCan(statements: Statement[], projectId: string, userId: string, r: RequestRow, destructive: boolean): RequestCan {
  const res = resource.project(projectId);
  const may = (a: "run:Approve" | "run:ApplyDestructive" | "run:Plan") => evaluate(statements, { action: a, resource: res }).allowed;
  const waiting = r.status === "waiting";
  const live = r.status === "waiting" || r.status === "approved";
  const other = r.requester_id !== userId;
  const decider = waiting && other && may("run:Approve");
  const facts: RequestFacts = { id: r.id, status: r.status, requester_id: r.requester_id, decided_by_id: r.decided_by_id };
  return {
    approve: decider && (!destructive || may("run:ApplyDestructive")),
    approveBlocked: decider && destructive && !may("run:ApplyDestructive") ? "destructive_forbidden" : null,
    reject: decider,
    withdraw: live && !other,
    replan: live && !other && may("run:Plan"),
    apply: r.status === "approved" && applyPath(statements, projectId, userId, facts, destructive).ok,
  };
}

/** When an apply of a plan finishes, the request that covers it says so: applied, or a note that it failed (the request then shows as out of date). */
export async function closeAfterApply(db: Db, planRunId: string | null, applyRunId: string, ok: boolean, error: string | null, by: { userId: string | null; username: string }): Promise<void> {
  if (!planRunId) return;
  const r = await liveRequestOf(db, planRunId);
  if (!r) return;
  if (ok) {
    await db.updateTable("requests").set({ status: "applied", updated_at: sql`now()` }).where("id", "=", r.id).execute();
    await addEvent(db, r.id, by, "applied", null, { run: applyRunId });
  } else {
    await addEvent(db, r.id, by, "apply_failed", error?.slice(0, 500) ?? null, { run: applyRunId });
  }
}

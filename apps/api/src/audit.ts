import type { Db } from "./db.ts";

export interface AuditEntry {
  actor?: { userId: string; username: string } | null;
  /** the name tried, when nobody is signed in */
  actorName?: string;
  action: string;
  resource?: string;
  outcome: "success" | "denied" | "failure";
  ip?: string;
  details?: Record<string, unknown>;
}

/** Appends one row. The log never holds a password or a token: callers pass only what happened and to what. */
export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db.insertInto("audit_log").values({
    actor_id: e.actor?.userId ?? null,
    actor_username: e.actor?.username ?? e.actorName ?? null,
    action: e.action,
    resource: e.resource ?? null,
    outcome: e.outcome,
    ip: e.ip ?? null,
    details: JSON.stringify(e.details ?? {}),
  }).execute();
}

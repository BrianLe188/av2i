import type { Design } from "@av2i/model";
import { api } from "./api.ts";

export interface ProjectSummary {
  id: string;
  name: string;
  owner: string | null;
  ownerId: string;
  rev: number;
  updatedAt: string;
  updatedBy: string | null;
  nodes: number;
  edges: number;
  can: { write: boolean; delete: boolean };
}

export interface ProjectFull {
  project: { id: string; name: string; owner: string | null; ownerId: string; rev: number; updatedAt: string; updatedBy: string | null; design: Design; rescuePending?: boolean; createdAt?: string; connection?: { id: string; name: string } | null };
  can: { write: boolean; delete: boolean; share: boolean; plan: boolean; variables: boolean; approve: boolean; apply: boolean };
}

export interface VersionRow { version: number; note: string; auto: boolean; createdAt: string; by: string | null; nodes: number }

export const listProjects = () => api<{ projects: ProjectSummary[] }>("GET", "/api/projects").then((r) => r.projects);
export const createProject = (design?: Design, name?: string) => api<{ project: { id: string } }>("POST", "/api/projects", { ...(design ? { design } : {}), ...(name ? { name } : {}) }).then((r) => r.project);
export const getProject = (id: string) => api<ProjectFull>("GET", `/api/projects/${id}`);
export const saveProject = (id: string, design: Design, baseRev: number) => api<{ rev: number; updatedAt: string }>("PUT", `/api/projects/${id}`, { design, baseRev });
export const deleteProject = (id: string) => api("DELETE", `/api/projects/${id}`);
export const listVersions = (id: string) => api<{ versions: VersionRow[] }>("GET", `/api/projects/${id}/versions`).then((r) => r.versions);
export const saveVersion = (id: string, note: string) => api<{ version: number }>("POST", `/api/projects/${id}/versions`, { note });
export const restoreVersion = (id: string, n: number) => api<{ rev: number; design: Design }>("POST", `/api/projects/${id}/versions/${n}/restore`);

export type MemberRole = "viewer" | "editor" | "runner" | "approver" | "maintainer" | "custom";
export interface ShareRow { id: string; kind: "user" | "group"; name: string; role: MemberRole; actions: string[]; grantedBy: string | null; createdAt: string }
export interface Members {
  owner: string | null; shares: ShareRow[]; roles: { role: Exclude<MemberRole, "custom">; actions: string[] }[];
  /** every project permission, and the ones the signed-in person holds in this project (they can grant only those) */
  actions: string[]; mine: string[]; canManage: boolean;
}

export const listShares = (id: string) => api<Members>("GET", `/api/projects/${id}/shares`);
export const shareTargets = (id: string) => api<{ users: string[]; groups: string[] }>("GET", `/api/projects/${id}/share-targets`);
export const putShare = (id: string, who: { user: string } | { group: string }, role: MemberRole, actions?: string[]) => api("PUT", `/api/projects/${id}/shares`, { ...who, role, ...(role === "custom" ? { actions: actions ?? [] } : {}) });
export const removeShare = (id: string, shareId: string) => api("DELETE", `/api/projects/${id}/shares/${shareId}`);

export interface PlanSummary { add: number; change: number; destroy: number; replace: number; destructive: boolean; resources: { address: string; type: string; actions: string[] }[] }
export interface RunRow {
  id: string; projectId: string; kind: "plan" | "apply"; status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  planRunId: string | null;
  createdBy: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; error: string | null; summary: PlanSummary | AppliedSummary | null;
}
export interface AppliedSummary { added: number; changed: number; destroyed: number }

export const queuePlan = (id: string) => api<{ run: RunRow }>("POST", `/api/projects/${id}/runs`, { kind: "plan" }).then((r) => r.run);
export const listRuns = (id: string) => api<{ runs: RunRow[] }>("GET", `/api/projects/${id}/runs`).then((r) => r.runs);
export interface Blocker { code: string }
export interface RequestCan { approve: boolean; approveBlocked: "destructive_forbidden" | null; reject: boolean; withdraw: boolean; replan: boolean; apply: boolean }
export interface ApplyInfo { blockers: Blocker[]; destructive: boolean; expiresAt: string | null; applyRun: { id: string; status: RunRow["status"] } | null }
export interface RunDetail {
  run: RunRow;
  apply?: ApplyInfo;
  request?: { id: string; number: number; status: RequestStatus; requester: string; decidedBy: string | null; can: RequestCan } | null;
  can?: { plan: boolean; approve: boolean; apply: boolean; applyDestructive: boolean; applyNow: boolean; applyBlocked: string | null; request: boolean };
  replaceable?: { id: string; number: number }[];
}
export type RequestStatus = "waiting" | "approved" | "applied" | "closed";
export const getRun = (id: string) => api<RunDetail>("GET", `/api/runs/${id}`);
export const applyRun = (id: string, confirmName?: string) => api<{ run: RunRow }>("POST", `/api/runs/${id}/apply`, confirmName !== undefined ? { confirmName } : {}).then((r) => r.run);

export interface RescueRow { id: string; runId: string | null; serial: number; createdAt: string; resolvedAt: string | null; resolution: "restored" | "dismissed" | null; resolvedBy: string | null }
export const listRescues = (projectId: string) => api<{ rescues: RescueRow[] }>("GET", `/api/projects/${projectId}/state-rescues`).then((r) => r.rescues);
export const restoreRescue = (id: string) => api("POST", `/api/state-rescues/${id}/restore`);
export const dismissRescue = (id: string, confirmName: string) => api("POST", `/api/state-rescues/${id}/dismiss`, { confirmName });
export const rescueDownloadUrl = (id: string) => `/api/state-rescues/${id}/download`;
export const runLogs = (id: string, after: number) => api<{ lines: { seq: number; line: string }[]; done: boolean }>("GET", `/api/runs/${id}/logs?after=${after}`);
export const cancelRun = (id: string) => api<{ run: RunRow }>("POST", `/api/runs/${id}/cancel`).then((r) => r.run);

export type PreflightIdentity =
  | { ok: true; account: string; arn: string; via: "role" | "server"; roleArn?: string }
  | { ok: false; reason: "none" | "error" | "no_connection" | "forbidden" | "trust" | "base" | "other"; message: string; roleArn?: string };
export interface Preflight {
  key: boolean;
  tofu: { ok: true; version: string } | { ok: false; message: string };
  identity: PreflightIdentity;
  connection: { id: string; name: string; planOnly: boolean } | null;
  timeoutMinutes: number;
  rescuePending: boolean;
}
export const preflight = (id: string) => api<Preflight>("GET", `/api/projects/${id}/preflight`);

export interface VariableRow { name: string; sensitive: boolean; node: string; set: boolean; updatedAt: string | null; updatedBy: string | null }
export const listVariables = (id: string) => api<{ variables: VariableRow[] }>("GET", `/api/projects/${id}/variables`).then((r) => r.variables);
export const setVariable = (id: string, name: string, value: string) => api("PUT", `/api/projects/${id}/variables/${encodeURIComponent(name)}`, { value });
export const removeVariable = (id: string, name: string) => api("DELETE", `/api/projects/${id}/variables/${encodeURIComponent(name)}`);

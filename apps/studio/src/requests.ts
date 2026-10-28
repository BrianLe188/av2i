import { api } from "./api.ts";
import type { RequestCan, RequestStatus } from "./projects.ts";

export interface PlanSize { add: number; change: number; destroy: number; replace: number; destructive: boolean }
export interface RequestRow {
  id: string; number: number; kind: "apply"; status: RequestStatus; closeReason: "rejected" | "withdrawn" | null;
  projectId: string; projectName: string; requester: string; decidedBy: string | null; createdAt: string; updatedAt: string; size: PlanSize | null;
}
export interface RequestEvent { id: number; at: string; actor: string; kind: "requested" | "comment" | "approved" | "rejected" | "withdrawn" | "replanned" | "applied" | "apply_failed"; body: string | null; data: Record<string, unknown> }
export interface RequestDetail {
  request: RequestRow & { planRunId: string | null; decidedAt: string | null };
  plan: { id: string; summary: import("./projects.ts").PlanSummary | null; createdBy: string | null; finishedAt: string | null } | null;
  apply: { blockers: { code: string }[]; stale: string[]; expiresAt: string | null; destructive: boolean };
  events: RequestEvent[];
  can: RequestCan & { comment: boolean };
  newerPlans: { id: string; finished_at: string }[];
  me: string;
}

export const listRequests = (scope: "awaiting" | "mine" | "project", projectId?: string) =>
  api<{ requests: RequestRow[] }>("GET", `/api/requests?scope=${scope}${projectId ? `&projectId=${projectId}` : ""}`).then((r) => r.requests);
export const requestSummary = () => api<{ awaiting: number; mine: number }>("GET", "/api/requests/summary");
export const getRequest = (id: string) => api<RequestDetail>("GET", `/api/requests/${id}`);
export const sendRequest = (runId: string, note?: string) => api<{ request: { id: string; number: number } }>("POST", `/api/runs/${runId}/request`, note ? { note } : {}).then((r) => r.request);
export const approveRequest = (id: string, note?: string) => api("POST", `/api/requests/${id}/approve`, note ? { note } : {});
export const rejectRequest = (id: string, note: string) => api("POST", `/api/requests/${id}/reject`, { note });
export const withdrawRequest = (id: string) => api("POST", `/api/requests/${id}/withdraw`);
export const commentRequest = (id: string, body: string) => api("POST", `/api/requests/${id}/comments`, { body });
export const replanRequest = (id: string, planRunId: string) => api("POST", `/api/requests/${id}/replan`, { planRunId });

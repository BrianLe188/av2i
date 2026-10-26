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
  project: { id: string; name: string; owner: string | null; ownerId: string; rev: number; updatedAt: string; updatedBy: string | null; design: Design };
  can: { write: boolean; delete: boolean; share: boolean; plan: boolean };
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

export interface ShareRow { id: string; kind: "user" | "group"; name: string; role: "viewer" | "editor"; grantedBy: string | null; createdAt: string }

export const listShares = (id: string) => api<{ owner: string | null; shares: ShareRow[] }>("GET", `/api/projects/${id}/shares`);
export const shareTargets = (id: string) => api<{ users: string[]; groups: string[] }>("GET", `/api/projects/${id}/share-targets`);
export const putShare = (id: string, who: { user: string } | { group: string }, role: "viewer" | "editor") => api("PUT", `/api/projects/${id}/shares`, { ...who, role });
export const removeShare = (id: string, shareId: string) => api("DELETE", `/api/projects/${id}/shares/${shareId}`);

export interface PlanSummary { add: number; change: number; destroy: number; replace: number; destructive: boolean; resources: { address: string; type: string; actions: string[] }[] }
export interface RunRow {
  id: string; projectId: string; kind: "plan" | "apply"; status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  createdBy: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; error: string | null; summary: PlanSummary | null;
}

export const queuePlan = (id: string) => api<{ run: RunRow }>("POST", `/api/projects/${id}/runs`, { kind: "plan" }).then((r) => r.run);
export const listRuns = (id: string) => api<{ runs: RunRow[] }>("GET", `/api/projects/${id}/runs`).then((r) => r.runs);
export const getRun = (id: string) => api<{ run: RunRow }>("GET", `/api/runs/${id}`).then((r) => r.run);
export const runLogs = (id: string, after: number) => api<{ lines: { seq: number; line: string }[]; done: boolean }>("GET", `/api/runs/${id}/logs?after=${after}`);
export const cancelRun = (id: string) => api<{ run: RunRow }>("POST", `/api/runs/${id}/cancel`).then((r) => r.run);

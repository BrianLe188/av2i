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
  can: { write: boolean; delete: boolean; share: boolean };
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

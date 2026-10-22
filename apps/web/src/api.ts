import type { Graph, Issue } from '@av2i/core';

export interface ProjectSummary {
  id: string;
  name: string;
  region: string;
  nodeCount: number;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  region: string;
  graph: Graph;
  updatedAt: string;
}

export interface VersionSummary {
  id: string;
  label: string | null;
  nodeCount: number;
  createdAt: string;
}

export interface User {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface AuthConfig {
  github: boolean;
  devLogin: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
/** Called when a request comes back 401 (e.g. the session expired mid-edit). */
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new ApiError(message ?? `${res.status} ${res.statusText}`, res.status);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  authConfig: () => request<AuthConfig>('/auth/config'),
  me: () => request<User>('/auth/me'),
  devLogin: () => request<User>('/auth/dev-login', json('POST')),
  logout: () => request<void>('/auth/logout', json('POST')),
  listProjects: () => request<ProjectSummary[]>('/projects'),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (name: string, region?: string, graph?: Graph) =>
    request<Project>('/projects', json('POST', { name, region, graph })),
  updateProject: (id: string, patch: { name?: string; region?: string; graph?: Graph }) =>
    request<Project>(`/projects/${id}`, json('PUT', patch)),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, json('DELETE')),
  listVersions: (id: string) => request<VersionSummary[]>(`/projects/${id}/versions`),
  snapshot: (id: string, label?: string) =>
    request<VersionSummary>(`/projects/${id}/versions`, json('POST', { label })),
  restore: (id: string, versionId: string) =>
    request<Project>(`/projects/${id}/versions/${versionId}/restore`, json('POST')),
  exportProject: (id: string) =>
    request<{ files: Record<string, string>; issues: Issue[] }>(`/projects/${id}/export`),
};

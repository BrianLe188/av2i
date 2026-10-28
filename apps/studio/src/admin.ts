import { api } from "./api.ts";

export interface GroupRow { id: string; name: string; description: string; members: number; policies: string[]; createdAt: string }
export interface GroupDetail {
  group: { id: string; name: string; description: string; createdAt: string };
  members: { id: string; username: string; displayName: string; disabled: boolean }[];
  policies: string[];
}
export interface PolicyRow { name: string; description: string; builtin: boolean; customized?: boolean; updatedAt: string; users: number; groups: number }
export interface PolicyDetail {
  policy: { name: string; description: string; builtin: boolean; customized: boolean; document: unknown; defaultDocument?: unknown; updatedAt: string };
  /** permissions added by a later version since this built-in policy was changed */
  newActions: string[];
  users: { id: string; username: string }[];
  groups: { id: string; name: string }[];
}
export interface Simulation { allowed: boolean; reason: "allow" | "explicit-deny" | "implicit-deny"; sid?: string }

export const listGroups = () => api<{ groups: GroupRow[] }>("GET", "/api/groups").then((r) => r.groups);
export const createGroup = (name: string, description: string) => api<{ group: { id: string } }>("POST", "/api/groups", { name, description }).then((r) => r.group);
export const getGroup = (id: string) => api<GroupDetail>("GET", `/api/groups/${id}`);
export const updateGroup = (id: string, description: string) => api("PATCH", `/api/groups/${id}`, { description });
export const deleteGroup = (id: string) => api("DELETE", `/api/groups/${id}`);
export const setMembers = (id: string, userIds: string[]) => api("PUT", `/api/groups/${id}/members`, { userIds });
export const setGroupPolicies = (id: string, policies: string[]) => api("PUT", `/api/groups/${id}/policies`, { policies });

export const listPolicies = () => api<{ policies: PolicyRow[] }>("GET", "/api/policies").then((r) => r.policies);
export const getPolicy = (name: string) => api<PolicyDetail>("GET", `/api/policies/${encodeURIComponent(name)}`);
export const createPolicy = (name: string, description: string, document: unknown) => api("POST", "/api/policies", { name, description, document });
export const updatePolicy = (name: string, body: { description?: string; document?: unknown }) => api("PUT", `/api/policies/${encodeURIComponent(name)}`, body);
export const deletePolicy = (name: string, force: boolean) => api("DELETE", `/api/policies/${encodeURIComponent(name)}${force ? "?force=true" : ""}`);
export const simulate = (userId: string, action: string, resource: string) => api<Simulation>("POST", "/api/policies/simulate", { userId, action, resource });
export const restorePolicyDefault = (name: string) => api("POST", `/api/policies/${encodeURIComponent(name)}/restore-default`);

export interface EffectiveRow { action: string; allowed: boolean; denied: boolean; sources: { kind: "policy" | "direct"; name: string; group?: string; scoped: boolean }[] }
export interface Permissions { direct: { all: boolean; actions: string[] }; effective: EffectiveRow[] }
export const getPermissions = (kind: "user" | "group", id: string) => api<Permissions>("GET", `/api/${kind}s/${id}/permissions`);
export const setDirectPermissions = (kind: "user" | "group", id: string, choice: { all: boolean; actions: string[] }) => api("PUT", `/api/${kind}s/${id}/direct-permissions`, choice);

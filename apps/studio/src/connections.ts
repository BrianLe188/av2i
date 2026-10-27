import { api } from "./api.ts";

export interface TestSide { ok: boolean; arn?: string; account?: string; code?: "trust" | "base" | "other"; message?: string }
export interface TestResult { plan: TestSide; apply: TestSide | null }

export interface ConnectionFull {
  view: "full";
  id: string; name: string; description: string; planRoleArn: string; applyRoleArn: string | null; account: string; planOnly: boolean;
  createdAt: string; updatedAt: string; lastTestAt: string | null; lastTest: TestResult | null; projects: number;
}
export interface ConnectionBrief { view: "brief"; id: string; name: string; description: string; account: string; planOnly: boolean }
export type ConnectionRow = ConnectionFull | ConnectionBrief;

export interface ConnectionDetail {
  connection: Omit<ConnectionFull, "view" | "projects"> & { externalId: string };
  usedBy: { id: string; name: string }[];
  server: { ok: true; arn: string; account: string; source: string; principal: string; pathWarning: boolean } | { ok: false; message: string };
  trustPolicy: string | null;
  planPolicy: string;
}

export interface ConnectionInput { name: string; description: string; planRoleArn: string; applyRoleArn: string | null }

export const listConnections = () => api<{ connections: ConnectionRow[] }>("GET", "/api/connections").then((r) => r.connections);
export const createConnection = (b: ConnectionInput) => api<{ connection: { id: string } }>("POST", "/api/connections", b).then((r) => r.connection);
export const getConnection = (id: string) => api<ConnectionDetail>("GET", `/api/connections/${id}`);
export const updateConnection = (id: string, b: Partial<ConnectionInput>) => api("PATCH", `/api/connections/${id}`, b);
export const deleteConnection = (id: string) => api("DELETE", `/api/connections/${id}`);
export const testConnection = (id: string) => api<{ lastTestAt: string; result: TestResult }>("POST", `/api/connections/${id}/test`);
export const setProjectConnection = (projectId: string, connectionId: string | null) => api("PUT", `/api/projects/${projectId}/connection`, { connectionId });

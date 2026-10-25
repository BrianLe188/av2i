import { api } from "./api.ts";

export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  actions: string[] | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  status: "active" | "revoked" | "expired";
}

export const listTokens = () => api<{ tokens: TokenRow[] }>("GET", "/api/tokens").then((r) => r.tokens);
export const createToken = (body: { name: string; expiresInDays: number | null; actions: string[] | null }) => api<{ token: TokenRow; secret: string }>("POST", "/api/tokens", body);
export const revokeToken = (id: string) => api("DELETE", `/api/tokens/${id}`);

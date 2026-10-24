import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Action } from "@av2i/authz";
import { api, ApiError, Unreachable } from "./api.ts";

export interface User {
  id: string;
  username: string;
  displayName: string;
  mustChangePassword: boolean;
}

interface Me {
  user: User;
  actions: Action[];
}

export type AuthState =
  | { status: "loading" }
  | { status: "unreachable" }
  | { status: "anonymous" }
  | { status: "ready"; user: User; actions: Action[] };

export interface Auth {
  state: AuthState;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  retry: () => void;
  /** whether the interface should offer an action; the server decides every call again */
  can: (action: Action) => boolean;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const apply = useCallback((me: Me) => setState({ status: "ready", user: me.user, actions: me.actions }), []);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      apply(await api<Me>("GET", "/api/auth/me"));
    } catch (e) {
      setState(e instanceof Unreachable ? { status: "unreachable" } : { status: "anonymous" });
    }
  }, [apply]);

  useEffect(() => { void load(); }, [load]);

  const value = useMemo<Auth>(() => ({
    state,
    login: async (username, password) => apply(await api<Me>("POST", "/api/auth/login", { username, password })),
    logout: async () => {
      try { await api("POST", "/api/auth/logout"); } catch (e) { if (!(e instanceof ApiError)) throw e; }
      setState({ status: "anonymous" });
    },
    changePassword: async (currentPassword, newPassword) => apply(await api<Me>("POST", "/api/auth/change-password", { currentPassword, newPassword })),
    retry: () => void load(),
    can: (action) => state.status === "ready" && state.actions.includes(action),
  }), [state, apply, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAuth outside AuthProvider");
  return a;
}

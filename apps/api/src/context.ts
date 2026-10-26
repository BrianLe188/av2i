import { evaluate, restrictToActions, type Action, type Statement } from "@av2i/authz";
import type { FastifyReply, FastifyRequest } from "fastify";
import { statementsFor } from "./access.ts";
import { audit } from "./audit.ts";
import { COOKIE, type SessionUser } from "./auth/sessions.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { forbidden, unauthorized } from "./errors.ts";

export interface Ctx {
  db: Db;
  config: Config;
}

export interface Auth {
  session: SessionUser;
  /** a cookie session, or an API token (which is limited to what it was made for and cannot manage accounts) */
  via: "session" | "token";
  /** the person's policy statements, read once per request and already narrowed to the token's scope */
  statements: () => Promise<Statement[]>;
  /** narrows statements of another origin (ownership, shares) the same way; unchanged for a session */
  scope: (statements: Statement[]) => Statement[];
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: Auth;
  }
  interface FastifyContextConfig {
    /** no sign in needed */
    public?: boolean;
    /** reachable while the password still has to be changed */
    allowMustChange?: boolean;
    /** called by an OpenTofu process with a run's own secret (no cookie, no CSRF header): the route checks it itself */
    runAuth?: boolean;
  }
}

export function makeAuth(ctx: Ctx, session: SessionUser, token?: { scope: string[] | null }): Auth {
  const scope = (statements: Statement[]) => (token?.scope ? restrictToActions(statements, token.scope) : statements);
  let cache: Promise<Statement[]> | undefined;
  return { session, via: token ? "token" : "session", scope, statements: () => (cache ??= statementsFor(ctx.db, session.userId).then(scope)) };
}

/** Account and token management are for a person at the keyboard: a token, which may sit in a script, cannot do them. */
export function sessionOnly(req: FastifyRequest): Auth {
  const auth = authOf(req);
  if (auth.via !== "session") throw forbidden("session_required", "Sign in with your password to do this; an API token cannot.");
  return auth;
}

export const authOf = (req: FastifyRequest): Auth => {
  if (!req.auth) throw unauthorized();
  return req.auth;
};

/** Throws 403 (and writes the refusal to the audit log) unless the signed-in person may do `action` on `resource`. */
export async function need(ctx: Ctx, req: FastifyRequest, action: Action, resource: string): Promise<void> {
  const auth = authOf(req);
  const decision = evaluate(await auth.statements(), { action, resource });
  if (decision.allowed) return;
  await audit(ctx.db, {
    actor: { userId: auth.session.userId, username: auth.session.username },
    action: "authz.denied", resource, outcome: "denied", ip: req.ip, details: { action, reason: decision.reason },
  });
  throw forbidden();
}

export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string, expires: Date): void {
  reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", secure: req.protocol === "https", expires });
}

export const clearSessionCookie = (reply: FastifyReply): void => void reply.clearCookie(COOKIE, { path: "/" });

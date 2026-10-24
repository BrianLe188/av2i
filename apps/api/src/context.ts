import { evaluate, type Action, type Statement } from "@av2i/authz";
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
  /** the person's policy statements, read once per request */
  statements: () => Promise<Statement[]>;
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
  }
}

export function makeAuth(ctx: Ctx, session: SessionUser): Auth {
  let cache: Promise<Statement[]> | undefined;
  return { session, statements: () => (cache ??= statementsFor(ctx.db, session.userId)) };
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

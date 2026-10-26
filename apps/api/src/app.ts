import { existsSync } from "node:fs";
import { join } from "node:path";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { COOKIE, findSession } from "./auth/sessions.ts";
import { findToken, looksLikeToken } from "./auth/tokens.ts";
import type { Config } from "./config.ts";
import { makeAuth, type Ctx } from "./context.ts";
import type { Db } from "./db.ts";
import { forbidden, HttpError, unauthorized } from "./errors.ts";
import { authRoutes } from "./routes/auth.ts";
import { groupRoutes } from "./routes/groups.ts";
import { policyRoutes } from "./routes/policies.ts";
import { projectRoutes } from "./routes/projects.ts";
import { runRoutes } from "./routes/runs.ts";
import { stateRoutes } from "./routes/state.ts";
import { tokenRoutes } from "./routes/tokens.ts";
import { userRoutes } from "./routes/users.ts";

/** Every state-changing call must carry this header: a form on another site cannot add it, so it cannot ride the cookie. */
export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "av2i";

export function buildApp(deps: { db: Db; config: Config; logger?: FastifyServerOptions["logger"] }): FastifyInstance {
  const { db, config } = deps;
  const ctx: Ctx = { db, config };
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: config.trustProxy, bodyLimit: 1_000_000 });
  void app.register(cookie);

  /** `Authorization: Bearer av2i_...`, or null when the call carries no bearer secret. */
  const bearerOf = (header: string | undefined) => {
    const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
    return m ? m[1]! : null;
  };

  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/")) return;
    const route = req.routeOptions.config ?? {};
    const bearer = bearerOf(req.headers.authorization);
    // a bearer call is not carried by a cookie, so a page on another site cannot forge it: the CSRF header only guards cookie calls
    if (!bearer && !route.runAuth && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers[CSRF_HEADER] !== CSRF_VALUE) throw forbidden("csrf", "Missing the X-Requested-With header.");
    if (route.public) return;
    if (bearer) {
      // when a secret is sent it alone decides: a valid cookie next to a bad token is not a way in
      const found = looksLikeToken(bearer) ? await findToken(db, bearer, req.ip) : null;
      if (!found) throw unauthorized("invalid_token", "That API token is not valid.");
      req.auth = makeAuth(ctx, found, found);
      if (found.mustChangePassword && !route.allowMustChange) throw new HttpError(403, "password_change_required", "Change your password first.");
      return;
    }
    const token = req.cookies[COOKIE];
    const session = token ? await findSession(db, config, token) : null;
    if (!session) throw unauthorized();
    req.auth = makeAuth(ctx, session);
    if (session.mustChangePassword && !route.allowMustChange) throw new HttpError(403, "password_change_required", "Change your password first.");
  });

  app.setErrorHandler((err: Error & { validation?: unknown; statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...err.extra } });
    if (err.validation) return reply.code(400).send({ error: { code: "invalid_request", message: err.message } });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { code: "invalid_request", message: err.message } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: "internal", message: "Something went wrong." } });
  });

  app.get("/api/health", { config: { public: true } }, async () => ({ ok: true }));
  authRoutes(app, ctx);
  userRoutes(app, ctx);
  groupRoutes(app, ctx);
  policyRoutes(app, ctx);
  projectRoutes(app, ctx);
  tokenRoutes(app, ctx);
  stateRoutes(app, ctx);
  runRoutes(app, ctx);

  app.all("/api/*", { config: { public: true } }, async (_req, reply) => reply.code(404).send({ error: { code: "not_found", message: "Not found." } }));

  if (config.staticDir && existsSync(join(config.staticDir, "index.html"))) {
    void app.register(fastifyStatic, { root: config.staticDir, wildcard: false });
    // the studio is a single page app: any other path loads it
    app.setNotFoundHandler((req, reply) => (req.method === "GET" && !req.url.startsWith("/api/") ? reply.sendFile("index.html") : reply.code(404).send({ error: { code: "not_found", message: "Not found." } })));
  }
  return app;
}

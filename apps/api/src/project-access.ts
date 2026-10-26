import { evaluate, ownerStatements, resource, shareStatements, type Action, type ShareRole, type Statement } from "@av2i/authz";
import type { FastifyRequest } from "fastify";
import { audit } from "./audit.ts";
import { authOf, type Ctx } from "./context.ts";
import { HttpError, notFound } from "./errors.ts";

/** What the project routes and the run routes share: who the caller is, which shares reach them, and the 404/403 rule for a project. */
export function projectAccess(ctx: Ctx) {
  const { db } = ctx;
  const actor = (req: FastifyRequest) => {
    const s = authOf(req).session;
    return { userId: s.userId, username: s.username };
  };

  /** The shares that reach this person: given to them, or to a group they belong to. */
  const sharesOf = async (userId: string, projectIds?: string[]) => {
    let q = db.selectFrom("project_shares").select(["project_id", "role"]).where((eb) => eb.or([
      eb("user_id", "=", userId),
      eb("group_id", "in", eb.selectFrom("group_members").select("group_id").where("user_id", "=", userId)),
    ]));
    if (projectIds) q = q.where("project_id", "in", projectIds);
    return q.execute();
  };

  /** Everything that may allow an action on this project: the person's policies, ownership and shares. A Deny among the policies still wins. */
  const accessOf = async (req: FastifyRequest, project: { id: string; owner_id: string }): Promise<Statement[]> => {
    const auth = authOf(req);
    const extra: Statement[] = [];
    if (project.owner_id === auth.session.userId) extra.push(...ownerStatements(project.id));
    for (const s of await sharesOf(auth.session.userId, [project.id])) extra.push(...shareStatements(s.role as ShareRole, project.id));
    return [...(await auth.statements()), ...auth.scope(extra)];
  };

  /** 404 when the person may not even read the project (it must not reveal that it exists), 403 when they may read but not do `action`. */
  const authorize = async (req: FastifyRequest, project: { id: string; owner_id: string }, action: Action): Promise<Statement[]> => {
    const statements = await accessOf(req, project);
    const res = resource.project(project.id);
    if (!evaluate(statements, { action: "project:Read", resource: res }).allowed) throw notFound("No such project.");
    if (action !== "project:Read" && !evaluate(statements, { action, resource: res }).allowed) {
      await audit(db, { actor: actor(req), action: "authz.denied", resource: res, outcome: "denied", ip: req.ip, details: { action, reason: "no-allow" } });
      throw new HttpError(403, "forbidden", "You are not allowed to do that.");
    }
    return statements;
  };

  return { actor, sharesOf, accessOf, authorize };
}

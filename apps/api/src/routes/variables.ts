import { resource } from "@av2i/authz";
import { upgradeDesign, type Design } from "@av2i/model";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import type { Ctx } from "../context.ts";
import { badRequest, notFound } from "../errors.ts";
import { projectAccess } from "../project-access.ts";
import { requireKey } from "../runs/crypto.ts";
import { requiredOf, setValue, storedOf } from "../runs/variables.ts";

const params = { type: "object", required: ["id", "name"], properties: { id: { type: "string", format: "uuid" }, name: { type: "string", maxLength: 128 } } } as const;
const idParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
/** A secret is a password or a token, not a document. */
const MAX_VALUE = 4096;

/**
 * The values a design asks for (a database password): set per project, kept encrypted, never sent back (DD-024). Only a name the
 * design asks for now can be set, so the table cannot fill with names nobody uses.
 */
export function variableRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const { actor, authorize } = projectAccess(ctx);

  const projectOf = async (id: string) => {
    const row = await db.selectFrom("projects").select(["id", "owner_id", "design"]).where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
    if (!row) throw notFound("No such project.");
    return row;
  };

  app.get("/api/projects/:id/variables", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const project = await projectOf(id);
    await authorize(req, project, "project:Read");
    const stored = new Map((await storedOf(db, id)).map((s) => [s.name, s]));
    const variables = requiredOf(upgradeDesign(project.design as Design)).map((v) => {
      const s = stored.get(v.name);
      return { name: v.name, sensitive: v.sensitive, node: v.node, set: !!s, updatedAt: s?.updatedAt ?? null, updatedBy: s?.updatedBy ?? null };
    });
    return { variables };
  });

  app.put("/api/projects/:id/variables/:name", {
    schema: { params, body: { type: "object", required: ["value"], additionalProperties: false, properties: { value: { type: "string", minLength: 1, maxLength: MAX_VALUE } } } },
  }, async (req) => {
    const { id, name } = req.params as { id: string; name: string };
    const project = await projectOf(id);
    await authorize(req, project, "variable:Write");
    const key = requireKey(config.stateKey);
    if (!requiredOf(upgradeDesign(project.design as Design)).some((v) => v.name === name)) throw badRequest("unknown_variable", "The design does not ask for this variable.");
    const me = actor(req);
    await setValue(db, key, id, name, (req.body as { value: string }).value, me.userId);
    await audit(db, { actor: me, action: "variable.set", resource: resource.project(id), outcome: "success", ip: req.ip, details: { name } });
    return { ok: true };
  });

  app.delete("/api/projects/:id/variables/:name", { schema: { params } }, async (req) => {
    const { id, name } = req.params as { id: string; name: string };
    await authorize(req, await projectOf(id), "variable:Write");
    const r = await db.deleteFrom("project_variables").where("project_id", "=", id).where("name", "=", name).executeTakeFirst();
    if (Number(r.numDeletedRows) === 0) throw notFound("No such variable.");
    await audit(db, { actor: actor(req), action: "variable.removed", resource: resource.project(id), outcome: "success", ip: req.ip, details: { name } });
    return { ok: true };
  });
}

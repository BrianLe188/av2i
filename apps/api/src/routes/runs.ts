import { createHash } from "node:crypto";
import { resource, type Statement } from "@av2i/authz";
import { checkDesign, upgradeDesign, type Design } from "@av2i/model";
import { getRegistry } from "@av2i/registry";
import { runRules } from "@av2i/rules";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import type { Ctx } from "../context.ts";
import { HttpError, notFound } from "../errors.ts";
import { projectAccess } from "../project-access.ts";
import { callerIdentity } from "../aws.ts";
import { requireKey } from "../runs/crypto.ts";
import { tofuVersion } from "../runs/runner.ts";

const idParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
/** Waiting runs per project: a person who keeps pressing Plan cannot fill the queue. */
const MAX_QUEUED = 5;

export interface RunsHooks {
  /** called after a run is queued so a worker looks for it now */
  wake?: () => void;
}
export const runsHooks: RunsHooks = {};

export function runRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const { actor, authorize } = projectAccess(ctx);

  const projectOf = async (id: string) => {
    const row = await db.selectFrom("projects").select(["id", "owner_id", "design", "name"]).where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
    if (!row) throw notFound("No such project.");
    return row;
  };
  const runOf = async (id: string) => {
    const row = await db.selectFrom("runs").select(["id", "project_id", "kind", "status", "design_hash", "created_by", "created_at", "started_at", "finished_at", "error", "summary", "state_serial"]).where("id", "=", id).executeTakeFirst();
    if (!row) throw notFound("No such run.");
    return row;
  };
  const view = async (r: Awaited<ReturnType<typeof runOf>>) => {
    const who = r.created_by ? (await db.selectFrom("users").select("username").where("id", "=", r.created_by).executeTakeFirst())?.username ?? null : null;
    return { id: r.id, projectId: r.project_id, kind: r.kind, status: r.status, createdBy: who, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, error: r.error, summary: r.summary ?? null };
  };

  app.post("/api/projects/:id/runs", {
    schema: { params: idParams, body: { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["plan"] } } } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await projectOf(id);
    await authorize(req, project, "run:Plan");
    requireKey(config.stateKey);
    const design = upgradeDesign(project.design as Design);
    const registry = getRegistry();
    const structural = checkDesign(design, registry);
    if (structural.length) throw new HttpError(422, "design_invalid", "The design is not valid.", { problems: structural.map((p) => `${p.where}: ${p.message}`) });
    const errors = runRules(design, registry).filter((f) => f.severity === "error");
    if (errors.length) throw new HttpError(422, "design_has_errors", "Fix the errors in the design first.", { findings: errors.map((f) => ({ rule: f.rule, targets: f.targets, message: f.message })) });
    const waiting = await db.selectFrom("runs").select(db.fn.countAll<string>().as("n")).where("project_id", "=", id).where("status", "=", "queued").executeTakeFirstOrThrow();
    if (Number(waiting.n) >= MAX_QUEUED) throw new HttpError(429, "queue_full", "This project already has several runs waiting.");
    const json = JSON.stringify(design);
    const me = actor(req);
    const row = await db.insertInto("runs").values({ project_id: id, kind: "plan", design: json, design_hash: createHash("sha256").update(json).digest("hex"), created_by: me.userId, error: null, plan_data: null, plan_nonce: null, plan_key_id: null, state_serial: null, state_token_hash: null })
      .returning("id").executeTakeFirstOrThrow();
    await audit(db, { actor: me, action: "run.queued", resource: resource.project(id), outcome: "success", ip: req.ip, details: { run: row.id, kind: "plan" } });
    runsHooks.wake?.();
    reply.code(201);
    return { run: await view(await runOf(row.id)) };
  });

  /** What a run would use, so the studio can say what is missing before anyone presses Plan. */
  app.get("/api/projects/:id/preflight", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    await authorize(req, await projectOf(id), "run:Plan");
    const [tofu, identity] = await Promise.all([tofuVersion(config.tofuBin), callerIdentity()]);
    return { key: !!config.stateKey, tofu, identity, timeoutMinutes: Math.round(config.runTimeoutMs / 60_000) };
  });

  app.get("/api/projects/:id/runs", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    await authorize(req, await projectOf(id), "project:Read");
    const rows = await db.selectFrom("runs").select(["id", "project_id", "kind", "status", "design_hash", "created_by", "created_at", "started_at", "finished_at", "error", "summary", "state_serial"]).where("project_id", "=", id).orderBy("created_at", "desc").limit(50).execute();
    return { runs: await Promise.all(rows.map(view)) };
  });

  const loadRun = async (req: Parameters<typeof authorize>[0], runId: string, action: Parameters<typeof authorize>[2]): Promise<[Awaited<ReturnType<typeof runOf>>, Statement[]]> => {
    const run = await runOf(runId);
    return [run, await authorize(req, await projectOf(run.project_id), action)];
  };

  app.get("/api/runs/:id", { schema: { params: idParams } }, async (req) => {
    const [run] = await loadRun(req, (req.params as { id: string }).id, "project:Read");
    return { run: await view(run) };
  });

  app.get("/api/runs/:id/logs", {
    schema: { params: idParams, querystring: { type: "object", properties: { after: { type: "integer", minimum: 0 } } } },
  }, async (req) => {
    const [run] = await loadRun(req, (req.params as { id: string }).id, "project:Read");
    const after = (req.query as { after?: number }).after ?? 0;
    const lines = await db.selectFrom("run_logs").select(["seq", "line"]).where("run_id", "=", run.id).where("seq", ">", after).orderBy("seq").limit(2000).execute();
    return { lines, done: run.status !== "queued" && run.status !== "running" };
  });

  app.post("/api/runs/:id/cancel", { schema: { params: idParams } }, async (req) => {
    const [run] = await loadRun(req, (req.params as { id: string }).id, "run:Plan");
    const r = await db.updateTable("runs").set({ status: "cancelled", finished_at: new Date() }).where("id", "=", run.id).where("status", "=", "queued").executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new HttpError(409, "not_queued", "Only a run that is still waiting can be cancelled.");
    await audit(db, { actor: actor(req), action: "run.cancelled", resource: resource.project(run.project_id), outcome: "success", ip: req.ip, details: { run: run.id } });
    return { run: await view(await runOf(run.id)) };
  });
}

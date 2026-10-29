import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@av2i/generator";
import type { Design } from "@av2i/model";
import { sql } from "kysely";
import { realGateway, type AwsGateway } from "../aws.ts";
import type { Config } from "../config.ts";
import { runIdentity } from "./credentials.ts";
import { storeRescue } from "./rescue.ts";
import { closeAfterApply } from "../requests.ts";
import type { Db } from "../db.ts";
import { open, requireKey, seal } from "./crypto.ts";
import { backendOf, s3BackendFile } from "./backend.ts";
import { requiredOf, valuesOf } from "./variables.ts";
import { summarizePlan } from "./plan.ts";
import type { Claimed } from "./queue.ts";

/** What the tofu process may inherit: the settings a proxy or a private CA need. Its AWS identity is made per run (runs/credentials.ts), never copied from the server. */
const PASS = /^(PATH|LANG|LC_.*|TZ|HTTPS?_PROXY|NO_PROXY|http_proxy|https_proxy|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR)$/;

/** Access keys and the run's own secret never reach the log. */
export function redactor(secrets: string[]): (line: string) => string {
  return (line) => {
    let out = line.replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, "$1****************");
    // a very short value would blank half the log; a database password is never that short
    for (const s of secrets) if (s.length >= 4) out = out.split(s).join("****");
    return out;
  };
}

const LOG_BATCH = 50;
const LOG_EVERY_MS = 400;

/** Writes the lines of a run to `run_logs` in small batches, so a long output is neither one insert per line nor lost at the end. */
export function logWriter(db: Db, runId: string, clean: (l: string) => string) {
  let seq = 0;
  let pending: { run_id: string; seq: number; line: string }[] = [];
  let flushing: Promise<void> = Promise.resolve();
  const flush = () => {
    const rows = pending;
    pending = [];
    if (rows.length) flushing = flushing.then(() => db.insertInto("run_logs").values(rows).execute().then(() => undefined));
    return flushing;
  };
  const timer = setInterval(() => void flush().catch(() => {}), LOG_EVERY_MS);
  return {
    line(l: string) {
      pending.push({ run_id: runId, seq: ++seq, line: clean(l).slice(0, 8000) });
      if (pending.length >= LOG_BATCH) void flush().catch(() => {});
    },
    async close() {
      clearInterval(timer);
      await flush();
    },
  };
}

interface Out { code: number; stdout: string; timedOut: boolean }

/** Milliseconds a stopped process gets to leave (so tofu can release its lock) before it is killed. */
const GRACE_MS = 10_000;

function run(bin: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; onLine: (l: string) => void; capture?: boolean; timeoutMs: number; stopSignal?: NodeJS.Signals; graceMs?: number }): Promise<Out> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let timedOut = false;
    let killer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill(opts.stopSignal ?? "SIGTERM");
      killer = setTimeout(() => p.kill("SIGKILL"), opts.graceMs ?? GRACE_MS);
    }, Math.max(1, opts.timeoutMs));
    const lines = () => {
      let rest = "";
      return {
        push(chunk: Buffer) {
          rest += chunk.toString("utf8");
          const parts = rest.split("\n");
          rest = parts.pop() ?? "";
          for (const l of parts) opts.onLine(l);
        },
        end() { if (rest) opts.onLine(rest); },
      };
    };
    const out = lines();
    const err = lines();
    // a capturing step keeps stdout whole (it is JSON for the caller) and logs only what goes to stderr
    p.stdout.on("data", (c: Buffer) => (opts.capture ? (stdout += c.toString("utf8")) : out.push(c)));
    p.stderr.on("data", (c: Buffer) => err.push(c));
    p.on("error", (e) => { clearTimeout(timer); clearTimeout(killer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killer);
      out.end();
      err.end();
      resolve({ code: code ?? 1, stdout, timedOut });
    });
  });
}

/** Whether the OpenTofu binary starts, and which version it is. */
export async function tofuVersion(bin: string): Promise<{ ok: true; version: string } | { ok: false; message: string }> {
  try {
    const r = await run(bin, ["version", "-json"], { cwd: tmpdir(), env: { PATH: process.env.PATH ?? "" }, onLine: () => {}, capture: true, timeoutMs: 8000 });
    if (r.timedOut) return { ok: false, message: "tofu did not answer in time." };
    if (r.code !== 0) return { ok: false, message: `tofu exited with code ${r.code}.` };
    return { ok: true, version: (JSON.parse(r.stdout) as { terraform_version?: string }).terraform_version ?? "unknown" };
  } catch (e) {
    return { ok: false, message: (e as NodeJS.ErrnoException).code === "ENOENT" ? `The program "${bin}" was not found; install OpenTofu or set TOFU_BIN.` : String(e) };
  }
}

export function backendFile(config: Config, projectId: string): string {
  const url = `${config.runnerApiUrl.replace(/\/$/, "")}/api/state/${projectId}`;
  return `terraform {
  backend "http" {
    address        = "${url}"
    lock_address   = "${url}"
    unlock_address = "${url}"
    lock_method    = "LOCK"
    unlock_method  = "UNLOCK"
  }
}
`;
}

/**
 * Runs one claimed run in a folder of its own: a plan stores its (encrypted) plan file and a summary; an apply applies the stored plan
 * file of its plan, with the configuration that plan was made from. An `errored.tfstate` that an apply leaves is saved before the folder
 * goes (DD-026).
 */
export async function execute(db: Db, config: Config, claimed: Claimed, aws: AwsGateway = realGateway()): Promise<void> {
  const isApply = claimed.kind === "apply";
  // the values of variables join this list as they are read, so a secret that shows up in tofu's output never reaches the log
  const secrets = [claimed.token];
  const log = logWriter(db, claimed.id, redactor(secrets));
  let dir: string | null = null;
  let error: string | null = null;
  let applied: { added: number; changed: number; destroyed: number } | null = null;
  const limit = isApply ? config.applyTimeoutMs : config.runTimeoutMs;
  const deadline = Date.now() + limit;
  const timeoutMessage = `The ${claimed.kind} took longer than ${Math.round(limit / 60_000)} minute(s) and was stopped.`;
  try {
    const key = requireKey(config.stateKey);
    mkdirSync(join(config.runsDir, "plugin-cache"), { recursive: true });
    // the folder carries the run's id so that, after a crash, an errored.tfstate in it can be saved instead of deleted
    const work = (dir = mkdtempSync(join(config.runsDir, `run-${claimed.id}-`)));
    for (const [name, text] of Object.entries(generate(claimed.design as Design))) if (name.endsWith(".tf")) writeFileSync(join(work, name), text);
    const backend = backendOf((await db.selectFrom("projects").select("state_backend").where("id", "=", claimed.project_id).executeTakeFirst())?.state_backend);
    // a plan on S3 takes no lock, so the plan role can stay read-only; an apply locks with the native lock file (DD-032)
    writeFileSync(join(work, "backend.tf"), backend.kind === "s3" ? s3BackendFile(backend, isApply) : backendFile(config, claimed.project_id));
    const env: NodeJS.ProcessEnv = { HOME: work, TF_IN_AUTOMATION: "1", TF_INPUT: "0", TF_PLUGIN_CACHE_DIR: join(config.runsDir, "plugin-cache"), TF_HTTP_USERNAME: "run", TF_HTTP_PASSWORD: claimed.token };
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && PASS.test(k)) env[k] = v;
    const who = await runIdentity({ db, config, aws }, claimed);
    Object.assign(env, who.env);
    secrets.push(...who.secrets);
    log.line(who.summary);
    await db.updateTable("runs").set({ role_arn: who.roleArn, aws_account: who.account }).where("id", "=", claimed.id).execute();
    if (!isApply) {
      // a saved plan already holds its values, so only a plan needs them
      const needed = requiredOf(claimed.design as Design).map((v) => v.name);
      const values = await valuesOf(db, key, claimed.project_id, needed);
      const absent = needed.filter((n) => !(n in values));
      if (absent.length) throw new Error(`No value is set for: ${absent.join(", ")}.`);
      for (const [n, v] of Object.entries(values)) { env[`TF_VAR_${n}`] = v; secrets.push(v); }
    }
    const tail: string[] = [];
    const step = async (title: string, args: string[], capture = false) => {
      log.line(`$ tofu ${title}`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(timeoutMessage);
      const r = await run(config.tofuBin, args, {
        cwd: work, env, capture, timeoutMs: left,
        // an apply is asked to stop, not killed: it finishes what is in flight and writes its state
        ...(isApply ? { stopSignal: "SIGINT" as const, graceMs: config.applyGraceMs } : {}),
        onLine: (l) => { log.line(l); tail.push(l); if (tail.length > 40) tail.shift(); },
      });
      if (r.timedOut) throw new Error(timeoutMessage);
      if (r.code !== 0) throw new Error(`tofu ${title} exited with code ${r.code}`);
      return r;
    };
    await step("init", ["init", "-input=false", "-no-color"]);
    if (isApply) {
      const plan = claimed.plan_run_id ? await db.selectFrom("runs").select(["plan_data", "plan_nonce", "plan_key_id"]).where("id", "=", claimed.plan_run_id).executeTakeFirst() : undefined;
      if (!plan?.plan_data || !plan.plan_nonce || !plan.plan_key_id) throw new Error("The plan this apply belongs to has no stored plan file.");
      writeFileSync(join(work, "plan.bin"), open(key, { keyId: plan.plan_key_id, nonce: plan.plan_nonce, data: plan.plan_data }));
      await step("apply", ["apply", "-input=false", "-no-color", "-lock=true", "plan.bin"]);
      const m = /Apply complete! Resources: (\d+) added, (\d+) changed, (\d+) destroyed/.exec(tail.join("\n"));
      applied = m ? { added: Number(m[1]), changed: Number(m[2]), destroyed: Number(m[3]) } : null;
      if (applied) await db.updateTable("runs").set({ summary: JSON.stringify(applied) }).where("id", "=", claimed.id).execute();
    } else {
      await step("plan", ["plan", "-input=false", "-no-color", `-lock=${backend.kind === "s3" ? "false" : "true"}`, "-out=plan.bin"]);
      const shown = await step("show -json", ["show", "-json", "plan.bin"], true);
      const summary = summarizePlan(JSON.parse(shown.stdout));
      log.line(`Plan: ${summary.add} to add, ${summary.change} to change, ${summary.destroy} to destroy, ${summary.replace} to replace.`);
      const sealed = seal(key, readFileSync(join(work, "plan.bin")));
      const serial = await db.selectFrom("state_versions").select("serial").where("project_id", "=", claimed.project_id).orderBy("id", "desc").limit(1).executeTakeFirst();
      await db.updateTable("runs").set({ summary: JSON.stringify(summary), plan_data: sealed.data, plan_nonce: sealed.nonce, plan_key_id: sealed.keyId, state_serial: serial?.serial ?? null })
        .where("id", "=", claimed.id).execute();
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    log.line(`Failed: ${error}`);
  } finally {
    // OpenTofu leaves errored.tfstate when it created things but could not write the state: it is the only record of them
    if (isApply && dir && config.stateKey && existsSync(join(dir, "errored.tfstate"))) {
      const where = await storeRescue(db, config, config.stateKey, { projectId: claimed.project_id, runId: claimed.id, text: readFileSync(join(dir, "errored.tfstate"), "utf8") });
      error = `${error ? `${error}. ` : ""}Resources were created but the state could not be saved. It was kept ${where === "db" ? "in the platform" : "in a file under the rescue folder of the runs"}; restore or download it before running anything else.`;
      log.line(`!! ${error}`);
    }
    await log.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    // runs of one project never overlap, so a lock still held now belongs to nobody: tofu was stopped before it could unlock
    await db.deleteFrom("state_locks").where("project_id", "=", claimed.project_id).execute();
    await db.updateTable("runs").set({ status: error ? "failed" : "succeeded", finished_at: sql`now()`, error, state_token_hash: null }).where("id", "=", claimed.id).execute();
    if (isApply) {
      // the request that covers the plan learns how its apply ended
      const who = claimed.created_by ? (await db.selectFrom("users").select("username").where("id", "=", claimed.created_by).executeTakeFirst())?.username : undefined;
      await closeAfterApply(db, claimed.plan_run_id, claimed.id, !error, error, { userId: claimed.created_by, username: who ?? "platform" }).catch(() => {});
    }
  }
}

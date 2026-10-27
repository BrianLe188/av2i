import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@av2i/generator";
import type { Design } from "@av2i/model";
import { sql } from "kysely";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import { requireKey, seal } from "./crypto.ts";
import { requiredOf, valuesOf } from "./variables.ts";
import { summarizePlan } from "./plan.ts";
import type { Claimed } from "./queue.ts";

/** What the tofu process may inherit: the server's own AWS identity (R1) and the settings a proxy or a private CA need. Nothing else. */
const PASS = /^(PATH|LANG|LC_.*|TZ|AWS_.*|HTTPS?_PROXY|NO_PROXY|http_proxy|https_proxy|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR)$/;

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

function run(bin: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; onLine: (l: string) => void; capture?: boolean; timeoutMs: number }): Promise<Out> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let timedOut = false;
    let killer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill("SIGTERM");
      killer = setTimeout(() => p.kill("SIGKILL"), GRACE_MS);
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

/** Folders a cut-off run left behind (they hold the plan file in clear): removed at start, when no run can be using one. Returns how many. */
export function sweepRunDirs(runsDir: string): number {
  if (!existsSync(runsDir)) return 0;
  const gone = readdirSync(runsDir).filter((n) => /^run-/.test(n));
  for (const n of gone) rmSync(join(runsDir, n), { recursive: true, force: true });
  return gone.length;
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

/** Plans a design with OpenTofu in a folder of its own and stores the plan (encrypted) and a summary of it. Apply comes with R2. */
export async function execute(db: Db, config: Config, claimed: Claimed): Promise<void> {
  // the values of variables join this list as they are read, so a secret that shows up in tofu's output never reaches the log
  const secrets = [claimed.token];
  const log = logWriter(db, claimed.id, redactor(secrets));
  let dir: string | null = null;
  let error: string | null = null;
  const deadline = Date.now() + config.runTimeoutMs;
  const timeoutMessage = `The run took longer than ${Math.round(config.runTimeoutMs / 60_000)} minute(s) and was stopped.`;
  try {
    const key = requireKey(config.stateKey);
    mkdirSync(join(config.runsDir, "plugin-cache"), { recursive: true });
    const work = (dir = mkdtempSync(join(config.runsDir, "run-")));
    for (const [name, text] of Object.entries(generate(claimed.design as Design))) if (name.endsWith(".tf")) writeFileSync(join(work, name), text);
    writeFileSync(join(work, "backend.tf"), backendFile(config, claimed.project_id));
    const env: NodeJS.ProcessEnv = { HOME: work, TF_IN_AUTOMATION: "1", TF_INPUT: "0", TF_PLUGIN_CACHE_DIR: join(config.runsDir, "plugin-cache"), TF_HTTP_USERNAME: "run", TF_HTTP_PASSWORD: claimed.token };
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && PASS.test(k)) env[k] = v;
    const needed = requiredOf(claimed.design as Design).map((v) => v.name);
    const values = await valuesOf(db, key, claimed.project_id, needed);
    const absent = needed.filter((n) => !(n in values));
    if (absent.length) throw new Error(`No value is set for: ${absent.join(", ")}.`);
    for (const [n, v] of Object.entries(values)) { env[`TF_VAR_${n}`] = v; secrets.push(v); }
    const step = async (title: string, args: string[], capture = false) => {
      log.line(`$ tofu ${title}`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(timeoutMessage);
      const r = await run(config.tofuBin, args, { cwd: work, env, onLine: (l) => log.line(l), capture, timeoutMs: left });
      if (r.timedOut) throw new Error(timeoutMessage);
      if (r.code !== 0) throw new Error(`tofu ${title} exited with code ${r.code}`);
      return r;
    };
    await step("init", ["init", "-input=false", "-no-color"]);
    await step("plan", ["plan", "-input=false", "-no-color", "-lock=true", "-out=plan.bin"]);
    const shown = await step("show -json", ["show", "-json", "plan.bin"], true);
    const summary = summarizePlan(JSON.parse(shown.stdout));
    log.line(`Plan: ${summary.add} to add, ${summary.change} to change, ${summary.destroy} to destroy, ${summary.replace} to replace.`);
    const sealed = seal(key, readFileSync(join(work, "plan.bin")));
    const serial = await db.selectFrom("state_versions").select("serial").where("project_id", "=", claimed.project_id).orderBy("id", "desc").limit(1).executeTakeFirst();
    await db.updateTable("runs").set({ summary: JSON.stringify(summary), plan_data: sealed.data, plan_nonce: sealed.nonce, plan_key_id: sealed.keyId, state_serial: serial?.serial ?? null })
      .where("id", "=", claimed.id).execute();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    log.line(`Failed: ${error}`);
  } finally {
    await log.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    // runs of one project never overlap, so a lock still held now belongs to nobody: tofu was stopped before it could unlock
    await db.deleteFrom("state_locks").where("project_id", "=", claimed.project_id).execute();
    await db.updateTable("runs").set({ status: error ? "failed" : "succeeded", finished_at: sql`now()`, error, state_token_hash: null }).where("id", "=", claimed.id).execute();
  }
}

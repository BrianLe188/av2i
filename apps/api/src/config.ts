import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** the password `admin` gets on the very first start; `admin` itself when unset */
  adminInitialPassword: string | undefined;
  sessionIdleMinutes: number;
  sessionMaxHours: number;
  /** a folder with the built studio, served next to the API */
  staticDir: string | undefined;
  /** honour X-Forwarded-For and X-Forwarded-Proto from the reverse proxy in front */
  trustProxy: boolean;
  /** 32 bytes that encrypt state and stored plans; without it runs are refused (DD-023) */
  stateKey: Buffer | undefined;
  /** the OpenTofu binary the runner starts */
  tofuBin: string;
  /** how many runs may work at once (each project has at most one) */
  runWorkers: number;
  /** development only: a project with no connection runs with the server's own AWS_* (DD-025) */
  runWithServerIdentity: boolean;
  /** a run that takes longer is stopped and fails */
  runTimeoutMs: number;
  /** where runs make their temporary folders and keep the provider cache */
  runsDir: string;
  /** the address the tofu process uses to reach this server's state backend */
  runnerApiUrl: string;
}

const int = (v: string | undefined, fallback: number, name: string): number => {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number`);
  return n;
};

function key(v: string | undefined): Buffer | undefined {
  if (!v) return undefined;
  const raw = Buffer.from(v, "base64");
  if (raw.length !== 32) throw new Error("STATE_ENCRYPTION_KEY must be 32 random bytes in base64, for example the output of: openssl rand -base64 32");
  return raw;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required, for example postgres://user:password@host:5432/av2i");
  const port = int(env.PORT, 3000, "PORT");
  return {
    port,
    host: env.HOST || "0.0.0.0",
    databaseUrl,
    adminInitialPassword: env.ADMIN_INITIAL_PASSWORD || undefined,
    sessionIdleMinutes: int(env.SESSION_IDLE_MINUTES, 480, "SESSION_IDLE_MINUTES"),
    sessionMaxHours: int(env.SESSION_MAX_HOURS, 168, "SESSION_MAX_HOURS"),
    staticDir: env.STATIC_DIR || undefined,
    trustProxy: env.TRUST_PROXY === "true" || env.TRUST_PROXY === "1",
    stateKey: key(env.STATE_ENCRYPTION_KEY),
    tofuBin: env.TOFU_BIN || "tofu",
    runWorkers: int(env.RUN_WORKERS, 2, "RUN_WORKERS"),
    // temporary keys of an assumed role last an hour at most (role chaining), so a run may not outlast them
    runTimeoutMs: Math.min(int(env.RUN_TIMEOUT_MINUTES, 30, "RUN_TIMEOUT_MINUTES"), 55) * 60_000,
    runWithServerIdentity: env.RUN_WITH_SERVER_IDENTITY === "true" || env.RUN_WITH_SERVER_IDENTITY === "1",
    runsDir: env.RUNS_DIR || join(tmpdir(), "av2i-runs"),
    runnerApiUrl: env.RUNNER_API_URL || `http://127.0.0.1:${port}`,
  };
}

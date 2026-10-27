import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { buildApp, CSRF_HEADER, CSRF_VALUE } from "../src/app.ts";
import type { AssumeRequest, AwsGateway } from "../src/aws.ts";
import { ensureAdmin, syncBuiltinPolicies } from "../src/bootstrap.ts";
import { COOKIE } from "../src/auth/sessions.ts";
import type { Config } from "../src/config.ts";
import { createDb, type Db } from "../src/db.ts";
import { migrate } from "../src/migrate.ts";

/** The PostgreSQL the tests create their throwaway databases in; see apps/api/README.md for the one-line docker command. */
export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://av2i:av2i@127.0.0.1:55432/av2i";

export async function postgresAvailable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

export interface Reply {
  status: number;
  body: any;
  headers: Record<string, unknown>;
  /** the session cookie the reply set, if any */
  cookie: string | null;
  setCookie: string | null;
}

export interface TestApp {
  db: Db;
  config: Config;
  call: (method: string, url: string, opts?: { body?: unknown; cookie?: string | null; csrf?: boolean; headers?: Record<string, string> }) => Promise<Reply>;
  login: (username: string, password: string) => Promise<Reply>;
  /** admin, with the first password already changed */
  admin: () => Promise<string>;
  close: () => Promise<void>;
}

export const ADMIN_PASSWORD = "Correct-Horse-Battery-1";

export const SERVER_ARN = "arn:aws:sts::111122223333:assumed-role/av2i-server/i-0abc";

/** Stands in for AWS: roles listed in `deny` refuse to be assumed; every call is recorded. */
export function fakeAws(opts: { deny?: Record<string, "trust" | "base" | "other"> } = {}): AwsGateway & { calls: { assume: AssumeRequest[] } } {
  const calls = { assume: [] as AssumeRequest[] };
  return {
    calls,
    async identity(keys) {
      return keys ? { ok: true, account: "999988887777", arn: "arn:aws:sts::999988887777:assumed-role/fake/session" } : { ok: true, account: "111122223333", arn: SERVER_ARN, source: "instance" };
    },
    async assume(req) {
      calls.assume.push(req);
      const deny = opts.deny?.[req.roleArn];
      if (deny) return { ok: false, code: deny, message: "denied by the fake" };
      return {
        ok: true, arn: `arn:aws:sts::${/:(\d{12}):/.exec(req.roleArn)![1]}:assumed-role/x/${req.sessionName}`, account: /:(\d{12}):/.exec(req.roleArn)![1]!,
        keys: { accessKeyId: "ASIAFAKEKEYFAKEKEY12", secretAccessKey: "fake-secret-access-key-value", sessionToken: "fake-session-token-value", expiration: new Date(Date.now() + 3_600_000) },
      };
    },
  };
}

export async function testApp(over: Partial<Config> = {}, aws?: AwsGateway): Promise<TestApp> {
  const name = `av2i_test_${randomBytes(6).toString("hex")}`;
  const root = new pg.Client({ connectionString: ADMIN_URL });
  await root.connect();
  await root.query(`create database ${name}`);
  await root.end();
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const config: Config = {
    port: 0, host: "127.0.0.1", databaseUrl: url.toString(), adminInitialPassword: undefined,
    sessionIdleMinutes: 480, sessionMaxHours: 168, staticDir: undefined, trustProxy: false,
    stateKey: randomBytes(32), tofuBin: "tofu", runWorkers: 1, runTimeoutMs: 600_000, runWithServerIdentity: false, runsDir: join(tmpdir(), `av2i-test-${name}`), runnerApiUrl: "http://127.0.0.1:0", ...over,
  };
  const db = createDb(config.databaseUrl);
  await migrate(db);
  await syncBuiltinPolicies(db);
  await ensureAdmin(db, config, { warn: () => {} });
  const app = buildApp({ db, config, ...(aws ? { aws } : {}) });
  await app.ready();

  const call: TestApp["call"] = async (method, url2, opts = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.csrf !== false && method !== "GET") headers[CSRF_HEADER] = CSRF_VALUE;
    if (opts.cookie) headers.cookie = `${COOKIE}=${opts.cookie}`;
    const res = await app.inject({ method: method as "GET", url: url2, headers, ...(opts.body !== undefined ? { payload: opts.body as object } : {}) });
    const set = res.headers["set-cookie"];
    const line = (Array.isArray(set) ? set : set ? [set] : []).find((c) => c.startsWith(`${COOKIE}=`)) ?? null;
    const value = line ? line.slice(COOKIE.length + 1).split(";")[0]! : null;
    let body: any = null;
    try { body = res.body ? JSON.parse(res.body) : null; } catch { body = res.body; }
    return { status: res.statusCode, body, headers: res.headers as Record<string, unknown>, cookie: value === "" ? null : value, setCookie: line };
  };
  const login: TestApp["login"] = (username, password) => call("POST", "/api/auth/login", { body: { username, password } });
  const admin: TestApp["admin"] = async () => {
    const first = await login("admin", "admin");
    const changed = await call("POST", "/api/auth/change-password", { cookie: first.cookie, body: { currentPassword: "admin", newPassword: ADMIN_PASSWORD } });
    if (changed.status !== 200 || !changed.cookie) throw new Error(`could not prepare the admin: ${JSON.stringify(changed.body)}`);
    return changed.cookie;
  };
  const close = async () => {
    await app.close();
    await db.destroy();
    const r = new pg.Client({ connectionString: ADMIN_URL });
    await r.connect();
    await r.query(`drop database if exists ${name} with (force)`);
    await r.end();
  };
  return { db, config, call, login, admin, close };
}

/** A signed-in user with the policies given (admin does the creating); returns what the tests need to act as them. */
export async function addMember(t: TestApp, admin: string, username: string, policies: string[] = []): Promise<{ id: string; cookie: string; password: string }> {
  const made = await t.call("POST", "/api/users", { cookie: admin, body: { username } });
  if (made.status !== 201) throw new Error(`could not create ${username}: ${JSON.stringify(made.body)}`);
  const id = made.body.user.id as string;
  if (policies.length) {
    const r = await t.call("PUT", `/api/users/${id}/policies`, { cookie: admin, body: { policies } });
    if (r.status !== 200) throw new Error(`could not set policies: ${JSON.stringify(r.body)}`);
  }
  const first = await t.login(username, made.body.temporaryPassword);
  const password = `${username}-Fresh-Password-1`;
  const changed = await t.call("POST", "/api/auth/change-password", { cookie: first.cookie, body: { currentPassword: made.body.temporaryPassword, newPassword: password } });
  if (changed.status !== 200 || !changed.cookie) throw new Error(`could not prepare ${username}`);
  return { id, cookie: changed.cookie, password };
}

export const blankDesign = (name = "untitled", nodes: { key: string }[] = []) => ({
  schema: 1, name, settings: { region: "ap-southeast-1" },
  nodes: nodes.map((n) => ({ key: n.key, label: n.key, service: "vpc", props: {} })), edges: [],
});

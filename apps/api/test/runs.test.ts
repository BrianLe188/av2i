import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, blankDesign, postgresAvailable, testApp, type TestApp } from "./helpers.ts";
import { hashToken } from "../src/routes/state.ts";
import { open, seal } from "../src/runs/crypto.ts";
import { summarizePlan } from "../src/runs/plan.ts";
import { claim, failStale } from "../src/runs/queue.ts";
import { execute } from "../src/runs/runner.ts";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const available = await postgresAvailable();
const design = JSON.parse(readFileSync(join(import.meta.dirname, "../../../packages/testkit/designs/container-backend.json"), "utf8"));

describe("state encryption", () => {
  it("round-trips, and a changed byte or another key is refused", () => {
    const key = randomBytes(32);
    const sealed = seal(key, Buffer.from("hello state"));
    expect(open(key, sealed).toString()).toBe("hello state");
    expect(sealed.data.includes(Buffer.from("hello"))).toBe(false);
    const bad = { ...sealed, data: Buffer.from(sealed.data) };
    bad.data[0] = bad.data[0]! ^ 1;
    expect(() => open(key, bad)).toThrow();
    expect(() => open(randomBytes(32), sealed)).toThrow(/key/);
  });
});

describe("plan summary", () => {
  it("counts adds, changes, deletes and replaces, ignores no-ops, and marks deletes and replaces destructive", () => {
    const s = summarizePlan({ resource_changes: [
      { address: "a", type: "t", change: { actions: ["create"] } },
      { address: "b", type: "t", change: { actions: ["update"] } },
      { address: "c", type: "t", change: { actions: ["delete"] } },
      { address: "d", type: "t", change: { actions: ["create", "delete"] } },
      { address: "e", type: "t", change: { actions: ["no-op"] } },
      { address: "f", type: "t", change: { actions: ["read"] } },
    ] });
    expect(s).toMatchObject({ add: 1, change: 1, destroy: 1, replace: 1, destructive: true });
    expect(s.resources.map((r) => r.address)).toEqual(["a", "b", "c", "d"]);
    expect(summarizePlan({ resource_changes: [{ address: "a", type: "t", change: { actions: ["create"] } }] }).destructive).toBe(false);
    expect(summarizePlan({}).resources).toEqual([]);
  });
});

describe.skipIf(!available)("runs", () => {
  let t: TestApp;
  let admin: string;
  let alice: { id: string; cookie: string };
  let viewer: { id: string; cookie: string };
  let nobody: { id: string; cookie: string };
  let projectId: string;

  beforeAll(async () => {
    t = await testApp({ tofuBin: join(import.meta.dirname, "fake-tofu.sh"), runWithServerIdentity: true });
    admin = await t.admin();
    alice = await addMember(t, admin, "alice", ["ProjectEditor"]);
    viewer = await addMember(t, admin, "vera", ["ProjectViewer"]);
    nobody = await addMember(t, admin, "nina");
    const made = await t.call("POST", "/api/projects", { cookie: alice.cookie, body: { design } });
    projectId = made.body.project.id;
  });
  afterAll(async () => { await t.close(); });

  const plan = (cookie: string, id = projectId) => t.call("POST", `/api/projects/${id}/runs`, { cookie, body: { kind: "plan" } });
  const work = async () => {
    const c = await claim(t.db);
    if (c) await execute(t.db, t.config, c);
    return c;
  };

  it("lets the owner queue a plan but not a viewer, and nobody who cannot read the project", async () => {
    expect((await plan(viewer.cookie)).status).toBe(403);
    const other = await addMember(t, admin, "nora");
    expect((await plan(other.cookie)).status).toBe(404);
    const r = await plan(alice.cookie);
    expect(r.status).toBe(201);
    expect(r.body.run).toMatchObject({ kind: "plan", status: "queued", createdBy: "alice" });
    expect((await t.call("POST", `/api/runs/${r.body.run.id}/cancel`, { cookie: alice.cookie })).body.run.status).toBe("cancelled");
  });

  it("refuses a design with errors and says which", async () => {
    const bad = await t.call("POST", "/api/projects", { cookie: alice.cookie, body: { design: blankDesign("bad", [{ key: "v1" }]) } });
    const r = await plan(alice.cookie, bad.body.project.id);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toMatch(/design_/);
  });

  it("runs a plan, stores it encrypted with its summary, and keeps secrets out of the log and the process", async () => {
    process.env.SECRET_TEST_VAR = "do-not-leak";
    process.env.AWS_ACCESS_KEY_ID = "AKIAABCDEFGHIJKLMNOP";
    const r = await plan(alice.cookie);
    const done = await work();
    expect(done?.id).toBe(r.body.run.id);
    const run = (await t.call("GET", `/api/runs/${r.body.run.id}`, { cookie: alice.cookie })).body.run;
    expect(run.status).toBe("succeeded");
    expect(run.summary).toMatchObject({ add: 1, replace: 1, destructive: true });
    const logs = await t.call("GET", `/api/runs/${r.body.run.id}/logs`, { cookie: viewer.cookie });
    const text = logs.body.lines.map((l: { line: string }) => l.line).join("\n");
    expect(logs.body.done).toBe(true);
    expect(text).toContain("leak-check:none");
    expect(text).toContain("key:AKIA****************");
    expect(text).toContain("backend:1");
    expect(text).not.toContain(done!.token);
    const after = await t.call("GET", `/api/runs/${r.body.run.id}/logs?after=2`, { cookie: alice.cookie });
    expect(after.body.lines[0].seq).toBe(3);
    const row = await t.db.selectFrom("runs").select(["plan_data", "state_token_hash"]).where("id", "=", r.body.run.id).executeTakeFirstOrThrow();
    expect(row.plan_data?.includes(Buffer.from("plan-bytes"))).toBe(false);
    expect(row.state_token_hash).toBeNull();
    delete process.env.SECRET_TEST_VAR;
    delete process.env.AWS_ACCESS_KEY_ID;
  });

  it("takes one run per project at a time and marks runs cut off by a restart as failed", async () => {
    const a = await plan(alice.cookie);
    const b = await plan(alice.cookie);
    const first = await claim(t.db);
    expect(first?.id).toBe(a.body.run.id);
    expect(await claim(t.db)).toBeNull();
    expect(await failStale(t.db)).toBe(1);
    expect((await t.call("GET", `/api/runs/${a.body.run.id}`, { cookie: alice.cookie })).body.run.status).toBe("failed");
    expect((await claim(t.db))?.id).toBe(b.body.run.id);
    // the lock the cut-off tofu held is released with it
    await t.db.insertInto("state_locks").values({ project_id: projectId, lock_id: "dead", info: "{}" }).execute();
    await failStale(t.db);
    expect(await t.db.selectFrom("state_locks").selectAll().where("project_id", "=", projectId).execute()).toEqual([]);
  });

  it("stops a run that takes too long, fails it, and releases a lock tofu left behind", async () => {
    const slow = { ...t.config, tofuBin: join(import.meta.dirname, "fake-tofu-hang.sh"), runTimeoutMs: 700 };
    const r = await plan(alice.cookie);
    const c = await claim(t.db);
    expect(c?.id).toBe(r.body.run.id);
    await t.db.insertInto("state_locks").values({ project_id: projectId, lock_id: "stuck", info: "{}" }).execute();
    await execute(t.db, slow, c!);
    const run = (await t.call("GET", `/api/runs/${r.body.run.id}`, { cookie: alice.cookie })).body.run;
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/longer than/);
    expect(await t.db.selectFrom("state_locks").selectAll().where("project_id", "=", projectId).execute()).toEqual([]);
  });

  it("tells what a run would use before it starts, and only to someone who may plan", async () => {
    for (const k of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI"]) delete process.env[k];
    // a reader sees the state of the runs, but not what a plan would use
    const seen = await t.call("GET", `/api/projects/${projectId}/preflight`, { cookie: viewer.cookie });
    expect(seen.status).toBe(200);
    expect(seen.body.identity).toMatchObject({ ok: false, reason: "forbidden" });
    expect(seen.body.tofu.ok).toBe(false);
    expect((await t.call("GET", `/api/projects/${projectId}/preflight`, { cookie: nobody.cookie })).status).toBe(404);
    const r = await t.call("GET", `/api/projects/${projectId}/preflight`, { cookie: alice.cookie });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ key: true, tofu: { ok: true, version: "1.12.9" }, identity: { ok: false, reason: "none" }, timeoutMinutes: 10 });
    const missing = testApp({ tofuBin: "/no/such/tofu", stateKey: undefined, runWithServerIdentity: true });
    const m = await missing;
    try {
      const a = await m.admin();
      const made = await m.call("POST", "/api/projects", { cookie: a, body: { design } });
      const p = await m.call("GET", `/api/projects/${made.body.project.id}/preflight`, { cookie: a });
      expect(p.body).toMatchObject({ key: false, tofu: { ok: false } });
      expect(p.body.tofu.message).toMatch(/not found/);
    } finally { await m.close(); }
  });

  describe("state backend", () => {
    let token: string;
    let planToken: string;
    const url = () => `/api/state/${projectId}`;
    const basic = (secret: string) => ({ authorization: `Basic ${Buffer.from(`run:${secret}`).toString("base64")}` });
    const state = (serial: number, lineage = "abc", extra: object = {}) => ({ version: 4, serial, lineage, outputs: {}, resources: [], ...extra });
    const call = (method: string, path: string, secret = token, body?: unknown) =>
      t.call(method, path, { csrf: false, headers: basic(secret), ...(body !== undefined ? { body } : {}) });
    const runRow = (kind: "plan" | "apply", secret: string) =>
      t.db.insertInto("runs").values({ project_id: projectId, kind, status: "running", design: "{}", design_hash: "x", created_by: null, error: null, plan_data: null, plan_nonce: null, plan_key_id: null, state_serial: null, state_token_hash: hashToken(secret) }).returning("id").executeTakeFirstOrThrow();

    beforeAll(async () => {
      // a project runs one thing at a time, so these two runs stand for two moments
      token = randomBytes(16).toString("hex");
      planToken = randomBytes(16).toString("hex");
      await runRow("apply", token);
    });

    const lock = async (id = "L1") => expect((await call("LOCK", url(), token, { ID: id })).status).toBe(200);
    const unlock = (id = "L1") => call("UNLOCK", url(), token, { ID: id });

    it("refuses a call without the secret of a running run", async () => {
      expect((await t.call("GET", url(), { csrf: false })).status).toBe(401);
      expect((await call("GET", url(), "wrong")).status).toBe(401);
      expect((await t.call("GET", url(), { cookie: admin })).status).toBe(401);
    });

    it("never lets a plan write, even with the lock", async () => {
      await runRow("plan", planToken);
      expect((await call("POST", `${url()}?ID=P`, planToken, state(1))).status).toBe(403);
      await t.db.deleteFrom("runs").where("state_token_hash", "=", hashToken(planToken)).execute();
    });

    it("writes only under the lock of the run that writes", async () => {
      expect((await call("POST", `${url()}?ID=L1`, token, state(1))).body.error.code).toBe("lock_required");
      await lock();
      expect((await call("POST", url(), token, state(1))).status).toBe(423);
      expect((await call("POST", `${url()}?ID=other`, token, state(1))).status).toBe(423);
      expect((await call("POST", `${url()}?ID=L1`, token, { nope: true })).status).toBe(400);
      await unlock();
    });

    it("has no state at first, then keeps every version encrypted, returns the newest and records the run", async () => {
      expect((await call("GET", url())).status).toBe(404);
      await lock();
      expect((await call("POST", `${url()}?ID=L1`, token, state(1))).status).toBe(200);
      expect((await call("POST", `${url()}?ID=L1`, token, state(2))).status).toBe(200);
      await unlock();
      expect((await call("GET", url())).body).toMatchObject({ serial: 2, lineage: "abc" });
      const rows = await t.db.selectFrom("state_versions").select(["serial", "data", "run_id"]).where("project_id", "=", projectId).orderBy("id").execute();
      expect(rows.map((r) => r.serial)).toEqual([1, 2]);
      expect(rows[0]!.data.includes(Buffer.from("lineage"))).toBe(false);
      expect(rows.every((r) => r.run_id !== null)).toBe(true);
    });

    it("refuses another lineage, an older serial and a different state with the same serial; a repeat is accepted and stored once", async () => {
      await lock();
      const post = (b: object) => call("POST", `${url()}?ID=L1`, token, b);
      expect((await post(state(3, "other"))).body.error.code).toBe("lineage_mismatch");
      expect((await post(state(1))).body.error.code).toBe("serial_regressed");
      expect((await post(state(2, "abc", { outputs: { changed: true } }))).body.error.code).toBe("serial_conflict");
      expect((await post(state(2))).status).toBe(200);
      expect(await t.db.selectFrom("state_versions").select("serial").where("project_id", "=", projectId).execute()).toHaveLength(2);
      await unlock();
    });

    it("locks, refuses a second lock, and unlocks", async () => {
      await lock("L3");
      const second = await call("LOCK", url(), token, { ID: "L4" });
      expect(second.status).toBe(423);
      expect(second.body.ID).toBe("L3");
      await unlock("L3");
      await lock("L5");
      await unlock("L5");
    });
  });
});

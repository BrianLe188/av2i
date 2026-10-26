import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, blankDesign, postgresAvailable, testApp, type TestApp } from "./helpers.ts";
import { hashToken } from "../src/routes/state.ts";
import { open, seal } from "../src/runs/crypto.ts";
import { summarizePlan } from "../src/runs/plan.ts";
import { claim, failStale } from "../src/runs/queue.ts";
import { execute, sweepRunDirs } from "../src/runs/runner.ts";
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

describe("folders of cut-off runs", () => {
  it("removes run folders and leaves the provider cache", () => {
    const root = mkdtempSync(join(tmpdir(), "av2i-sweep-"));
    mkdirSync(join(root, "run-abc"));
    writeFileSync(join(root, "run-abc", "plan.bin"), "x");
    mkdirSync(join(root, "plugin-cache"));
    expect(sweepRunDirs(root)).toBe(1);
    expect(existsSync(join(root, "run-abc"))).toBe(false);
    expect(existsSync(join(root, "plugin-cache"))).toBe(true);
    expect(sweepRunDirs(join(root, "missing"))).toBe(0);
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
  let projectId: string;

  beforeAll(async () => {
    t = await testApp({ tofuBin: join(import.meta.dirname, "fake-tofu.sh") });
    admin = await t.admin();
    alice = await addMember(t, admin, "alice", ["ProjectEditor"]);
    viewer = await addMember(t, admin, "vera", ["ProjectViewer"]);
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

  describe("state backend", () => {
    let token: string;
    const url = () => `/api/state/${projectId}`;
    const basic = (secret: string) => ({ authorization: `Basic ${Buffer.from(`run:${secret}`).toString("base64")}` });
    const state = (serial: number) => ({ version: 4, serial, lineage: "abc", outputs: {}, resources: [] });
    const call = (method: string, path: string, secret = token, body?: unknown) =>
      t.call(method, path, { csrf: false, headers: basic(secret), ...(body !== undefined ? { body } : {}) });

    beforeAll(async () => {
      token = randomBytes(16).toString("hex");
      await t.db.insertInto("runs").values({ project_id: projectId, kind: "plan", status: "running", design: "{}", design_hash: "x", created_by: null, error: null, plan_data: null, plan_nonce: null, plan_key_id: null, state_serial: null, state_token_hash: hashToken(token) }).execute();
    });

    it("refuses a call without the secret of a running run", async () => {
      expect((await t.call("GET", url(), { csrf: false })).status).toBe(401);
      expect((await call("GET", url(), "wrong")).status).toBe(401);
      expect((await t.call("GET", url(), { cookie: admin })).status).toBe(401);
    });

    it("has no state at first, then keeps every version encrypted and returns the newest", async () => {
      expect((await call("GET", url())).status).toBe(404);
      expect((await call("POST", url(), token, state(1))).status).toBe(200);
      expect((await call("POST", url(), token, state(2))).status).toBe(200);
      expect((await call("GET", url())).body).toMatchObject({ serial: 2, lineage: "abc" });
      const rows = await t.db.selectFrom("state_versions").select(["serial", "data"]).where("project_id", "=", projectId).orderBy("id").execute();
      expect(rows.map((r) => r.serial)).toEqual([1, 2]);
      expect(rows[0]!.data.includes(Buffer.from("lineage"))).toBe(false);
      expect((await call("POST", url(), token, { nope: true })).status).toBe(400);
    });

    it("locks, refuses a second lock and a write without the lock id, and unlocks", async () => {
      expect((await call("LOCK", url(), token, { ID: "L1", Who: "me" })).status).toBe(200);
      const second = await call("LOCK", url(), token, { ID: "L2" });
      expect(second.status).toBe(423);
      expect(second.body.ID).toBe("L1");
      expect((await call("POST", url(), token, state(3))).status).toBe(423);
      expect((await call("POST", `${url()}?ID=L1`, token, state(3))).status).toBe(200);
      expect((await call("UNLOCK", url(), token, { ID: "L1" })).status).toBe(200);
      expect((await call("LOCK", url(), token, { ID: "L3" })).status).toBe(200);
      await call("UNLOCK", url(), token, { ID: "L3" });
    });
  });
});

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seal } from "../src/runs/crypto.ts";
import { claim } from "../src/runs/queue.ts";
import { execute } from "../src/runs/runner.ts";
import { addMember, blankDesign, fakeAws, postgresAvailable, testApp, type TestApp } from "./helpers.ts";

const available = await postgresAvailable();
const here = import.meta.dirname;
const PLAN = "arn:aws:iam::123456789012:role/av2i-plan";
const APPLY = "arn:aws:iam::123456789012:role/av2i-apply";
const S3 = { kind: "s3", bucket: "my-state", key: "p.tfstate", region: "eu-west-1" };
const STATE = JSON.stringify({ version: 4, serial: 7, lineage: "L1", outputs: {}, resources: [{ mode: "managed", type: "aws_vpc", name: "a", provider: "p", instances: [{ attributes: { id: "vpc-1" } }] }] });

describe.skipIf(!available)("moving the state between backends", () => {
  const aws = fakeAws();
  let t: TestApp;
  let alice: { id: string; cookie: string };
  let pid: string;
  let platform: string, s3: string;

  const migrate = (body: object, id = pid) => t.call("POST", `/api/projects/${id}/state/migrate`, { cookie: alice.cookie, body });
  const runIt = async () => { const c = await claim(t.db); expect(c?.kind).toBe("migrate"); await execute(t.db, { ...t.config, tofuBin: join(here, "fake-tofu-migrate.sh") }, c!, aws); return c!.id; };
  const outcome = async (id: string) => t.db.selectFrom("runs").select(["status", "error"]).where("id", "=", id).executeTakeFirstOrThrow();

  beforeAll(async () => {
    t = await testApp({}, aws);
    const admin = await t.admin();
    alice = await addMember(t, admin, "alice", ["ProjectEditor"]);
    platform = join(t.config.runsDir, "fake-platform-store");
    s3 = join(t.config.runsDir, "fake-s3-store");
    mkdirSync(t.config.runsDir, { recursive: true });
    for (const f of [platform, s3]) rmSync(f, { force: true });
    pid = (await t.call("POST", "/api/projects", { cookie: alice.cookie, body: { design: blankDesign("Moved") } })).body.project.id;
    const conn = await t.db.insertInto("aws_connections").values({ name: "acct", plan_role_arn: PLAN, apply_role_arn: APPLY, external_id: "x" }).returning("id").executeTakeFirstOrThrow();
    await t.db.updateTable("projects").set({ connection_id: conn.id }).where("id", "=", pid).execute();
    const sealed = seal(t.config.stateKey!, Buffer.from(STATE));
    await t.db.insertInto("state_versions").values({ project_id: pid, serial: 7, lineage: "L1", key_id: sealed.keyId, nonce: sealed.nonce, data: sealed.data }).execute();
    writeFileSync(platform, STATE);
  });
  afterAll(async () => { await t.close(); });

  it("asks for the project name, a valid backend and a different one", async () => {
    expect((await migrate({ backend: S3, confirmName: "wrong" })).body.error.code).toBe("confirm_required");
    expect((await migrate({ backend: { ...S3, bucket: "X" }, confirmName: "Moved" })).body.error.code).toBe("invalid_backend");
    expect((await migrate({ backend: { kind: "platform" }, confirmName: "Moved" })).body.error.code).toBe("same_backend");
  });

  it("copies the state to S3, checks it, then records the new backend and keeps the old versions", async () => {
    const r = await migrate({ backend: S3, confirmName: "Moved" });
    expect(r.status).toBe(201);
    expect((await migrate({ backend: S3, confirmName: "Moved" })).body.error.code).toBe("run_active");
    const id = await runIt();
    expect(await outcome(id)).toMatchObject({ status: "succeeded", error: null });
    expect(readFileSync(s3, "utf8")).toBe(STATE);
    const p = await t.db.selectFrom("projects").select("state_backend").where("id", "=", pid).executeTakeFirstOrThrow();
    expect(p.state_backend).toMatchObject({ kind: "s3", bucket: "my-state" });
    expect((await t.db.selectFrom("state_versions").select("id").where("project_id", "=", pid).execute())).toHaveLength(1);
  });

  it("moves it back, and leaves the project alone when the destination holds another state", async () => {
    // a different state is already in the platform copy
    writeFileSync(platform, STATE.replace("L1", "OTHER"));
    expect((await migrate({ backend: { kind: "platform" }, confirmName: "Moved" })).status).toBe(201);
    const bad = await runIt();
    expect(await outcome(bad)).toMatchObject({ status: "failed" });
    expect((await outcome(bad)).error).toContain("different state");
    expect((await t.db.selectFrom("projects").select("state_backend").where("id", "=", pid).executeTakeFirstOrThrow()).state_backend).toMatchObject({ kind: "s3" });
    rmSync(platform, { force: true });
    expect((await migrate({ backend: { kind: "platform" }, confirmName: "Moved" })).status).toBe(201);
    expect(await outcome(await runIt())).toMatchObject({ status: "succeeded" });
    expect(existsSync(platform) && readFileSync(platform, "utf8")).toBe(STATE);
    expect((await t.db.selectFrom("projects").select("state_backend").where("id", "=", pid).executeTakeFirstOrThrow()).state_backend).toBeNull();
  });

  it("needs a connection with an apply role", async () => {
    await t.db.updateTable("aws_connections").set({ apply_role_arn: null }).execute();
    expect((await migrate({ backend: S3, confirmName: "Moved" })).body.error.code).toBe("plan_only_connection");
  });
});

describe.skipIf(!available)("a project whose state is in S3", () => {
  const SECRET = JSON.stringify({ version: 4, serial: 3, lineage: "L9", outputs: {}, resources: [{ mode: "managed", type: "aws_db_instance", name: "db", provider: "p", instances: [{ attributes: { id: "db-1", password: "hunter2" } }] }] });
  const aws = fakeAws({ s3: { text: SECRET } });
  let t: TestApp;
  let alice: { id: string; cookie: string };
  let other: { id: string; cookie: string };
  let pid: string;

  beforeAll(async () => {
    t = await testApp({}, aws);
    const admin = await t.admin();
    alice = await addMember(t, admin, "alice", ["ProjectEditor"]);
    other = await addMember(t, admin, "other");
    pid = (await t.call("POST", "/api/projects", { cookie: alice.cookie, body: { design: blankDesign("InS3") } })).body.project.id;
    const conn = await t.db.insertInto("aws_connections").values({ name: "acct", plan_role_arn: PLAN, apply_role_arn: APPLY, external_id: "x" }).returning("id").executeTakeFirstOrThrow();
    await t.db.updateTable("projects").set({ connection_id: conn.id, state_backend: JSON.stringify({ ...S3, encrypt: true }) }).where("id", "=", pid).execute();
  });
  afterAll(async () => { await t.close(); });
  const get = (path: string, cookie = alice.cookie) => t.call("GET", `/api/projects/${pid}/state/${path}`, { cookie });

  it("shows the current state with secrets hidden, and nothing to a stranger", async () => {
    const list = await get("versions");
    expect(list.body.backend).toMatchObject({ kind: "s3" });
    expect(list.body.versions).toHaveLength(1);
    expect(list.body.versions[0]).toMatchObject({ id: 0, serial: 3, resources: 1 });
    const one = await get("versions/0/resource?address=aws_db_instance.db");
    expect(JSON.stringify(one.body)).not.toContain("hunter2");
    expect((await get("versions/5")).status).toBe(404);
    expect((await get("versions", other.cookie)).status).toBe(404);
    expect(aws.calls.assume.at(-1)?.roleArn).toBe(PLAN);
  });

  it("gives the clear state to a writer, audited, as it is in S3", async () => {
    const dl = await get("versions/0/download");
    expect(dl.status).toBe(200);
    expect(JSON.stringify(dl.body)).toContain("hunter2");
  });

  it("checks the bucket and writes the policies the roles need", async () => {
    const r = await t.call("POST", `/api/projects/${pid}/state/check`, { cookie: alice.cookie, body: {} });
    expect(r.body).toMatchObject({ ok: true, versioning: { status: "Enabled" } });
    expect(JSON.stringify(r.body.policies.plan)).toContain("s3:GetObject");
    expect(JSON.stringify(r.body.policies.plan)).not.toContain("s3:PutObject");
    expect(JSON.stringify(r.body.policies.apply)).toContain("my-state/p.tfstate.tflock");
    expect((await t.call("POST", `/api/projects/${pid}/state/check`, { cookie: alice.cookie, body: { backend: { kind: "platform" } } })).body.error.code).toBe("not_s3");
  });
});

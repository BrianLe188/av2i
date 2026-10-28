import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { filesHash } from "../src/runs/apply.ts";
import { open } from "../src/runs/crypto.ts";
import { claim, failStale } from "../src/runs/queue.ts";
import { recoverRunDirs } from "../src/runs/rescue.ts";
import { execute } from "../src/runs/runner.ts";
import { addMember, fakeAws, postgresAvailable, testApp, type TestApp } from "./helpers.ts";

const available = await postgresAvailable();
const here = import.meta.dirname;
const design = JSON.parse(readFileSync(join(here, "../../../packages/testkit/designs/ec2-in-vpc.json"), "utf8"));
const PLAN = "arn:aws:iam::123456789012:role/av2i-plan";
const APPLY = "arn:aws:iam::123456789012:role/av2i-apply";

describe("the hash of the generated files", () => {
  it("ignores where boxes sit on the canvas and notices a change of what is generated", () => {
    const moved = structuredClone(design);
    moved.nodes[0].position = { x: 999, y: 111 };
    expect(filesHash(moved)).toBe(filesHash(design));
    const changed = structuredClone(design);
    changed.nodes.push({ key: "extra_bucket", label: "extra", service: "s3", props: { bucket: "extra-bucket-for-test" } });
    expect(filesHash(changed)).not.toBe(filesHash(design));
  });
});

describe.skipIf(!available)("apply with approval", () => {
  const aws = fakeAws();
  let t: TestApp;
  let admin: string;
  let alice: { id: string; cookie: string };
  let bob: { id: string; cookie: string };
  let connId: string;
  const tofu = (name: string) => join(here, name);
  const safe = () => ({ ...t.config, tofuBin: tofu("fake-tofu-safe.sh") });

  const policyFor = async (userId: string, name: string, actions: string[], res: string) => {
    const p = await t.db.insertInto("policies").values({ name, document: JSON.stringify({ Statement: [{ Effect: "Allow", Action: actions, Resource: [res] }] }) }).returning("id").executeTakeFirstOrThrow();
    await t.db.insertInto("policy_attachments").values({ policy_id: p.id, user_id: userId, group_id: null }).execute();
  };
  /** A project owned by alice, tied to the connection, shared with bob as a viewer. */
  const newProject = async (name: string) => {
    const made = await t.call("POST", "/api/projects", { cookie: alice.cookie, body: { name, design } });
    const id = made.body.project.id as string;
    expect((await t.call("PUT", `/api/projects/${id}/connection`, { cookie: alice.cookie, body: { connectionId: connId } })).status).toBe(200);
    await t.db.insertInto("project_shares").values({ project_id: id, user_id: bob.id, group_id: null, role: "viewer" }).execute();
    return id;
  };
  const queuePlan = async (projectId: string, cookie = alice.cookie) => (await t.call("POST", `/api/projects/${projectId}/runs`, { cookie, body: { kind: "plan" } })).body.run.id as string;
  /** Queues a plan and runs it with the given script until it is done. */
  const planned = async (projectId: string, script = "fake-tofu-safe.sh") => {
    // a test that queued an apply and did not run it must not hand it to the next claim
    await t.db.updateTable("runs").set({ status: "cancelled" }).where("status", "=", "queued").execute();
    const id = await queuePlan(projectId);
    const c = await claim(t.db);
    expect(c?.id).toBe(id);
    await execute(t.db, { ...t.config, tofuBin: tofu(script) }, c!, aws);
    return id;
  };
  const detail = async (runId: string, cookie = alice.cookie) => (await t.call("GET", `/api/runs/${runId}`, { cookie })).body;
  const apply = (runId: string, body: object = {}, cookie = alice.cookie) => t.call("POST", `/api/runs/${runId}/apply`, { cookie, body });
  const codes = (r: { body: { error?: { code: string; blockers?: { code: string }[] } } }) => r.body.error?.blockers?.map((b) => b.code) ?? [r.body.error?.code];

  beforeAll(async () => {
    t = await testApp({ tofuBin: tofu("fake-tofu.sh") }, aws);
    admin = await t.admin();
    alice = await addMember(t, admin, "alice", ["ProjectEditor"]);
    bob = await addMember(t, admin, "bob");
    await policyFor(bob.id, "BobDecides", ["run:Approve", "run:Apply", "state:Read"], "av2i:project/*");
    const c = await t.call("POST", "/api/connections", { cookie: admin, body: { name: "acct", planRoleArn: PLAN, applyRoleArn: APPLY } });
    connId = c.body.connection.id;
    await policyFor(alice.id, "AliceUsesAcct", ["connection:Use"], `av2i:connection/${connId}`);
  });
  afterAll(async () => { await t.close(); });

  it("applies the plan with the apply role, once, and says so afterwards", async () => {
    const pid = await newProject("once");
    const plan = await planned(pid);
    const d = await detail(plan);
    expect(d.apply).toMatchObject({ blockers: [], destructive: false });
    expect(d.can).toMatchObject({ apply: true });
    const r = await apply(plan);
    expect(r.status).toBe(201);
    expect(r.body.run).toMatchObject({ kind: "apply", status: "queued", planRunId: plan });
    expect(codes(await apply(plan))).toEqual(["already_applied"]);
    const c = await claim(t.db);
    await execute(t.db, safe(), c!, aws);
    expect(aws.calls.assume.at(-1)!.roleArn).toBe(APPLY);
    const done = (await detail(r.body.run.id)).run;
    expect(done).toMatchObject({ status: "succeeded", summary: { added: 2, changed: 0, destroyed: 0 } });
    expect((await detail(plan)).apply.applyRun).toMatchObject({ id: r.body.run.id, status: "succeeded" });
    expect(codes(await apply(plan))).toEqual(["already_applied"]);
  });

  it("asks for the permission and the typed name when a plan deletes or replaces", async () => {
    const pid = await newProject("destructive");
    const plan = await planned(pid, "fake-tofu.sh");
    const d = await detail(plan);
    expect(d.apply.destructive).toBe(true);
    expect(d.can.applyDestructive).toBe(false);
    expect((await apply(plan, { confirmName: "destructive" })).body.error.code).toBe("destructive_forbidden");
    await policyFor(alice.id, "AliceDestroys", ["run:ApplyDestructive"], `av2i:project/${pid}`);
    expect((await apply(plan)).body.error.code).toBe("confirm_required");
    expect((await apply(plan, { confirmName: "Destructive" })).body.error.code).toBe("confirm_required");
    expect((await apply(plan, { confirmName: "destructive" })).status).toBe(201);
  });

  it("refuses a plan that is out of date, and says every reason", async () => {
    const pid = await newProject("stale");
    const plan = await planned(pid);
    // moving a box does not matter
    const proj = (await t.call("GET", `/api/projects/${pid}`, { cookie: alice.cookie })).body.project;
    const moved = structuredClone(proj.design);
    moved.nodes[0].position = { x: 1234, y: 5678 };
    expect((await t.call("PUT", `/api/projects/${pid}`, { cookie: alice.cookie, body: { design: moved, baseRev: proj.rev } })).status).toBe(200);
    expect((await detail(plan)).apply.blockers).toEqual([]);
    // changing what is generated does
    const rev2 = (await t.call("GET", `/api/projects/${pid}`, { cookie: alice.cookie })).body.project.rev;
    const changed = structuredClone(moved);
    changed.nodes.push({ key: "extra_bucket", label: "extra", service: "s3", props: { bucket: "extra-bucket-for-test" } });
    await t.call("PUT", `/api/projects/${pid}`, { cookie: alice.cookie, body: { design: changed, baseRev: rev2 } });
    expect(codes(await apply(plan))).toEqual(["design_changed"]);
    // the connection, the age, the state and a pending rescue
    await t.db.updateTable("projects").set({ connection_id: null }).where("id", "=", pid).execute();
    await t.db.updateTable("runs").set({ finished_at: new Date(Date.now() - 25 * 3600_000) }).where("id", "=", plan).execute();
    await t.db.insertInto("state_versions").values({ project_id: pid, serial: 1, lineage: "l", key_id: "k", nonce: Buffer.alloc(12), data: Buffer.alloc(20) }).execute();
    await t.db.insertInto("state_rescues").values({ project_id: pid, run_id: null, serial: 9, lineage: "l", key_id: "k", nonce: Buffer.alloc(12), data: Buffer.alloc(20), resolved_by: null, resolution: null }).execute();
    expect(new Set(codes(await apply(plan)))).toEqual(new Set(["design_changed", "plan_expired", "connection_changed", "state_changed", "rescue_pending"]));
  });

  it("does not let an API token apply or send a plan for approval", async () => {
    const pid = await newProject("token");
    const plan = await planned(pid);
    const made = await t.call("POST", "/api/tokens", { cookie: alice.cookie, body: { name: "ci" } });
    const bearer = (method: string, url: string, body?: unknown) => t.call(method, url, { csrf: false, headers: { authorization: `Bearer ${made.body.secret}` }, ...(body !== undefined ? { body } : {}) });
    expect((await bearer("POST", `/api/runs/${plan}/apply`, {})).body.error.code).toBe("session_required");
    expect((await bearer("POST", `/api/runs/${plan}/request`, {})).body.error.code).toBe("session_required");
  });

  it("saves the state an apply could not write, locks the project, and lets a person restore, download or dismiss it", async () => {
    const pid = await newProject("rescue");
    const plan = await planned(pid);
    const r = await apply(plan);
    await execute(t.db, { ...t.config, tofuBin: tofu("fake-tofu-errored.sh") }, (await claim(t.db))!, aws);
    const run = (await detail(r.body.run.id)).run;
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/Resources were created but the state could not be saved/);
    const rows = await t.db.selectFrom("state_rescues").selectAll().where("project_id", "=", pid).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serial: 5, lineage: "lineage-of-the-rescue", resolved_at: null });
    expect(rows[0]!.data.includes(Buffer.from("lineage-of-the-rescue"))).toBe(false);
    const logs = (await t.call("GET", `/api/runs/${r.body.run.id}/logs`, { cookie: alice.cookie })).body.lines.map((l: { line: string }) => l.line).join("\n");
    expect(logs).toMatch(/!! .*Resources were created but the state could not be saved/);

    expect((await t.call("POST", `/api/projects/${pid}/runs`, { cookie: alice.cookie, body: { kind: "plan" } })).body.error.code).toBe("rescue_pending");
    const list = (await t.call("GET", `/api/projects/${pid}/state-rescues`, { cookie: alice.cookie })).body.rescues;
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("lineage-of-the-rescue");
    const id = list[0].id as string;

    const dl = await t.call("GET", `/api/state-rescues/${id}/download`, { cookie: alice.cookie });
    expect(dl.status).toBe(200);
    expect(dl.body).toMatchObject({ serial: 5, lineage: "lineage-of-the-rescue" });
    expect((await t.call("GET", `/api/state-rescues/${id}/download`, { cookie: bob.cookie })).status).toBe(200);
    expect(JSON.stringify(await t.db.selectFrom("audit_log").select("details").where("action", "=", "state.rescue_downloaded").execute())).not.toContain("lineage-of-the-rescue");

    // restoring needs state:Write, which the owner does not have by default
    expect((await t.call("POST", `/api/state-rescues/${id}/restore`, { cookie: alice.cookie })).status).toBe(403);
    await policyFor(alice.id, "AliceRestores", ["state:Write"], `av2i:project/${pid}`);
    expect((await t.call("POST", `/api/state-rescues/${id}/dismiss`, { cookie: alice.cookie, body: { confirmName: "nope" } })).body.error.code).toBe("confirm_required");
    expect((await t.call("POST", `/api/state-rescues/${id}/restore`, { cookie: alice.cookie })).status).toBe(200);
    const v = await t.db.selectFrom("state_versions").select(["serial", "lineage"]).where("project_id", "=", pid).execute();
    expect(v).toEqual([{ serial: 5, lineage: "lineage-of-the-rescue" }]);
    expect((await t.call("POST", `/api/state-rescues/${id}/restore`, { cookie: alice.cookie })).body.error.code).toBe("already_resolved");
    expect((await t.call("POST", `/api/projects/${pid}/runs`, { cookie: alice.cookie, body: { kind: "plan" } })).status).toBe(201);
  });

  it("refuses to restore a state that does not continue the stored one, and lets it be dismissed with the name", async () => {
    const pid = await newProject("rescue-two");
    await policyFor(alice.id, "AliceRestores2", ["state:Write"], `av2i:project/${pid}`);
    const sealed = (serial: number, lineage: string) => {
      const key = t.config.stateKey!;
      return import("../src/runs/crypto.ts").then(({ seal }) => seal(key, Buffer.from(JSON.stringify({ version: 4, serial, lineage }))));
    };
    const put = async (serial: number, lineage: string, into: "state_versions" | "state_rescues") => {
      const s = await sealed(serial, lineage);
      if (into === "state_versions") await t.db.insertInto("state_versions").values({ project_id: pid, serial, lineage, key_id: s.keyId, nonce: s.nonce, data: s.data }).execute();
      else return (await t.db.insertInto("state_rescues").values({ project_id: pid, run_id: null, serial, lineage, key_id: s.keyId, nonce: s.nonce, data: s.data, resolved_by: null, resolution: null }).returning("id").executeTakeFirstOrThrow()).id;
    };
    await put(7, "L", "state_versions");
    const other = (await put(9, "OTHER", "state_rescues"))!;
    const old = (await put(7, "L", "state_rescues"))!;
    expect((await t.call("POST", `/api/state-rescues/${other}/restore`, { cookie: alice.cookie })).body.error.code).toBe("lineage_mismatch");
    expect((await t.call("POST", `/api/state-rescues/${old}/restore`, { cookie: alice.cookie })).body.error.code).toBe("serial_not_newer");
    expect((await t.call("POST", `/api/state-rescues/${other}/dismiss`, { cookie: alice.cookie, body: { confirmName: "rescue-two" } })).status).toBe(200);
    expect((await t.call("POST", `/api/state-rescues/${old}/dismiss`, { cookie: alice.cookie, body: { confirmName: "rescue-two" } })).status).toBe(200);
    expect((await t.call("POST", `/api/projects/${pid}/runs`, { cookie: alice.cookie, body: { kind: "plan" } })).status).toBe(201);
  });

  it("marks an apply cut off by a restart as interrupted, and a plan as failed", async () => {
    const pid = await newProject("restart");
    const plan = await planned(pid);
    await apply(plan);
    const c = await claim(t.db);
    expect(c?.kind).toBe("apply");
    expect(await failStale(t.db)).toBe(1);
    const run = (await detail(c!.id)).run;
    expect(run.status).toBe("interrupted");
    expect(run.error).toMatch(/AWS may have changed/);
    expect((await detail(plan)).apply.blockers.map((b: { code: string }) => b.code)).toEqual([]);
  });

  it("stops an apply that takes too long, with a signal tofu can answer", async () => {
    const pid = await newProject("slow-apply");
    const plan = await planned(pid);
    await apply(plan);
    const c = await claim(t.db);
    await execute(t.db, { ...t.config, tofuBin: tofu("fake-tofu-hang.sh"), applyTimeoutMs: 700 }, c!, aws);
    const run = (await detail(c!.id)).run;
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/apply took longer/);
  });

  it("at start saves an errored.tfstate left in a folder by a crash, imports a rescue file, and removes the folders", async () => {
    const pid = await newProject("crash");
    const plan = await planned(pid);
    const r = await apply(plan);
    const root = mkdtempSync(join(tmpdir(), "av2i-recover-"));
    const config = { ...t.config, runsDir: root };
    mkdirSync(join(root, "plugin-cache"));
    const crashed = join(root, `run-${r.body.run.id}-abc123`);
    mkdirSync(crashed);
    writeFileSync(join(crashed, "errored.tfstate"), JSON.stringify({ version: 4, serial: 3, lineage: "crash-lineage" }));
    mkdirSync(join(root, "run-00000000-0000-0000-0000-000000000000-xyz"));
    const out = await recoverRunDirs(t.db, config);
    expect(out).toMatchObject({ removed: 2, rescued: 1 });
    expect(existsSync(crashed)).toBe(false);
    expect(existsSync(join(root, "plugin-cache"))).toBe(true);
    const rows = await t.db.selectFrom("state_rescues").selectAll().where("project_id", "=", pid).execute();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(open(t.config.stateKey!, { keyId: rows[0]!.key_id, nonce: rows[0]!.nonce, data: rows[0]!.data }).toString())).toMatchObject({ serial: 3, lineage: "crash-lineage" });
    // without the key nothing with a state in it is deleted
    const keep = join(root, `run-${r.body.run.id}-keep`);
    mkdirSync(keep);
    writeFileSync(join(keep, "errored.tfstate"), "{}");
    expect(await recoverRunDirs(t.db, { ...config, stateKey: undefined })).toMatchObject({ removed: 0 });
    expect(existsSync(keep)).toBe(true);
  });
});

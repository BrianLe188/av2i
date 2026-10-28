import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claim } from "../src/runs/queue.ts";
import { execute } from "../src/runs/runner.ts";
import { addMember, fakeAws, memberOf, postgresAvailable, testApp, type TestApp } from "./helpers.ts";

const available = await postgresAvailable();
const here = import.meta.dirname;
const design = JSON.parse(readFileSync(join(here, "../../../packages/testkit/designs/ec2-in-vpc.json"), "utf8"));
const PLAN = "arn:aws:iam::123456789012:role/av2i-plan";
const APPLY = "arn:aws:iam::123456789012:role/av2i-apply";

describe.skipIf(!available)("requests", () => {
  const aws = fakeAws();
  let t: TestApp;
  let admin: string;
  let alice: { id: string; cookie: string };
  let bob: { id: string; cookie: string };
  let carol: { id: string; cookie: string };
  let dave: { id: string; cookie: string };
  let connId: string;
  const tofu = (name: string) => join(here, name);

  const policyFor = async (userId: string, name: string, actions: string[], res: string) => {
    const p = await t.db.insertInto("policies").values({ name, document: JSON.stringify({ Statement: [{ Effect: "Allow", Action: actions, Resource: [res] }] }) }).returning("id").executeTakeFirstOrThrow();
    await t.db.insertInto("policy_attachments").values({ policy_id: p.id, user_id: userId, group_id: null }).execute();
  };
  /** A project of alice's, tied to the connection; bob is a runner in it and carol an approver (DD-028). */
  const newProject = async (name: string) => {
    const made = await t.call("POST", "/api/projects", { cookie: alice.cookie, body: { name, design } });
    const id = made.body.project.id as string;
    expect((await t.call("PUT", `/api/projects/${id}/connection`, { cookie: alice.cookie, body: { connectionId: connId } })).status).toBe(200);
    await t.db.insertInto("project_shares").values({ project_id: id, user_id: bob.id, group_id: null, ...memberOf("runner") }).execute();
    await t.db.insertInto("project_shares").values({ project_id: id, user_id: carol.id, group_id: null, ...memberOf("approver") }).execute();
    return id;
  };
  /** bob queues a plan and it is run with the given script. */
  const planned = async (projectId: string, by = bob, script = "fake-tofu-safe.sh") => {
    await t.db.updateTable("runs").set({ status: "cancelled" }).where("status", "=", "queued").execute();
    const q = await t.call("POST", `/api/projects/${projectId}/runs`, { cookie: by.cookie, body: { kind: "plan" } });
    expect(q.status).toBe(201);
    const c = await claim(t.db);
    await execute(t.db, { ...t.config, tofuBin: tofu(script) }, c!, aws);
    return q.body.run.id as string;
  };
  const run = async (id: string, cookie: string) => (await t.call("GET", `/api/runs/${id}`, { cookie })).body;
  const send = (runId: string, cookie = bob.cookie, note?: string) => t.call("POST", `/api/runs/${runId}/request`, { cookie, body: note ? { note } : {} });
  const act = (reqId: string, what: string, cookie: string, body: object = {}) => t.call("POST", `/api/requests/${reqId}/${what}`, { cookie, body });
  const detail = async (reqId: string, cookie: string) => (await t.call("GET", `/api/requests/${reqId}`, { cookie })).body;
  const apply = (runId: string, cookie: string, body: object = {}) => t.call("POST", `/api/runs/${runId}/apply`, { cookie, body });
  const finish = async (script = "fake-tofu-safe.sh") => execute(t.db, { ...t.config, tofuBin: tofu(script) }, (await claim(t.db))!, aws);
  const kinds = (d: { events: { kind: string }[] }) => d.events.map((e) => e.kind);

  beforeAll(async () => {
    t = await testApp({ tofuBin: tofu("fake-tofu.sh") }, aws);
    admin = await t.admin();
    alice = await addMember(t, admin, "alice", ["ProjectEditor"]);
    bob = await addMember(t, admin, "bob");
    carol = await addMember(t, admin, "carol");
    dave = await addMember(t, admin, "dave");
    const c = await t.call("POST", "/api/connections", { cookie: admin, body: { name: "acct", planRoleArn: PLAN, applyRoleArn: APPLY } });
    connId = c.body.connection.id;
    await policyFor(alice.id, "AliceUses", ["connection:Use"], `av2i:connection/${connId}`);
  });
  afterAll(async () => { await t.close(); });

  it("lets a member plan but not apply, send the plan for approval, and apply it once the owner approves", async () => {
    const pid = await newProject("flow");
    const plan = await planned(pid);
    const before = await run(plan, bob.cookie);
    expect(before.can).toMatchObject({ plan: true, applyNow: false, applyBlocked: "request_needed", request: true });
    expect((await apply(plan, bob.cookie)).body.error.code).toBe("request_needed");

    const sent = await send(plan, bob.cookie, "please check the new subnet");
    expect(sent.status).toBe(201);
    expect(sent.body.request.number).toBe(1);
    const reqId = sent.body.request.id as string;
    expect((await send(plan)).body.error.code).toBe("request_exists");
    expect((await run(plan, bob.cookie)).request).toMatchObject({ number: 1, status: "waiting", requester: "bob" });
    expect((await apply(plan, bob.cookie)).body.error.code).toBe("awaiting_approval");

    // who sees it where
    const awaiting = async (c: string) => (await t.call("GET", "/api/requests?scope=awaiting", { cookie: c })).body.requests;
    expect((await awaiting(alice.cookie)).map((r: { id: string }) => r.id)).toEqual([reqId]);
    expect((await awaiting(carol.cookie))).toHaveLength(1);
    expect(await awaiting(bob.cookie)).toEqual([]);
    expect(await awaiting(dave.cookie)).toEqual([]);
    expect((await t.call("GET", "/api/requests/summary", { cookie: alice.cookie })).body).toEqual({ awaiting: 1, mine: 0 });
    expect((await t.call("GET", "/api/requests/summary", { cookie: bob.cookie })).body).toEqual({ awaiting: 0, mine: 1 });
    const mine = (await t.call("GET", "/api/requests?scope=mine", { cookie: bob.cookie })).body.requests[0];
    expect(mine).toMatchObject({ number: 1, projectName: "flow", status: "waiting", size: { add: 1, destructive: false } });

    expect((await t.call("GET", `/api/requests/${reqId}`, { cookie: dave.cookie })).status).toBe(404);
    const d = await detail(reqId, alice.cookie);
    expect(d.can).toMatchObject({ approve: true, reject: true, withdraw: false, apply: false });
    expect(d.events[0]).toMatchObject({ kind: "requested", actor: "bob", body: "please check the new subnet" });

    // talk
    expect((await act(reqId, "comments", carol.cookie, { body: "looks fine to me" })).status).toBe(200);
    expect((await act(reqId, "comments", dave.cookie, { body: "hi" })).status).toBe(404);
    expect((await act(reqId, "comments", bob.cookie, { body: "   " })).status).toBe(400);

    // decide
    expect((await act(reqId, "approve", bob.cookie)).body.error.code).toBe("self_approval");
    expect((await act(reqId, "approve", dave.cookie)).status).toBe(404);
    expect((await act(reqId, "approve", alice.cookie)).status).toBe(200);
    expect((await act(reqId, "approve", carol.cookie)).body.error.code).toBe("not_waiting");
    const approved = await detail(reqId, bob.cookie);
    expect(approved.request).toMatchObject({ status: "approved", decidedBy: "alice" });
    expect(approved.can).toMatchObject({ apply: true, withdraw: true });
    expect(kinds(approved)).toEqual(["requested", "comment", "approved"]);

    // the approval covers this plan and lets the requester apply it, though bob has no run:Apply
    const queued = await apply(plan, bob.cookie);
    expect(queued.status).toBe(201);
    await finish();
    const done = await detail(reqId, bob.cookie);
    expect(done.request.status).toBe("applied");
    expect(kinds(done).at(-1)).toBe("applied");
    expect((await t.call("GET", "/api/requests/summary", { cookie: bob.cookie })).body.mine).toBe(0);
    expect(JSON.stringify(await t.db.selectFrom("audit_log").select("action").where("action", "like", "request.%").execute())).toContain("request.approved");
  });

  it("makes an approver hold run:ApplyDestructive for a plan that deletes, and still asks the typed name from whoever applies", async () => {
    const pid = await newProject("destructive-flow");
    const plan = await planned(pid, bob, "fake-tofu.sh");
    const reqId = (await send(plan)).body.request.id as string;
    expect((await run(plan, bob.cookie)).apply.destructive).toBe(true);
    // carol approves but holds no run:ApplyDestructive; the owner holds every project permission
    const seen = await detail(reqId, carol.cookie);
    expect(seen.can).toMatchObject({ approve: false, approveBlocked: "destructive_forbidden", reject: true });
    expect((await act(reqId, "approve", carol.cookie)).body.error.code).toBe("destructive_forbidden");
    expect((await detail(reqId, alice.cookie)).can).toMatchObject({ approve: true, approveBlocked: null });
    expect((await act(reqId, "approve", alice.cookie)).status).toBe(200);
    expect((await apply(plan, bob.cookie)).body.error.code).toBe("confirm_required");
    expect((await apply(plan, bob.cookie, { confirmName: "nope" })).body.error.code).toBe("confirm_required");
    expect((await apply(plan, bob.cookie, { confirmName: "destructive-flow" })).status).toBe(201);
  });

  it("lets an approver reject with a reason, and the requester withdraw", async () => {
    const pid = await newProject("reject-withdraw");
    const plan = await planned(pid);
    const first = (await send(plan)).body.request.id as string;
    expect((await act(first, "reject", carol.cookie, { note: "  " })).body.error.code).toBe("reason_required");
    expect((await act(first, "reject", bob.cookie, { note: "x" })).body.error.code).toBe("self_approval");
    expect((await act(first, "reject", carol.cookie, { note: "wrong region" })).status).toBe(200);
    const closed = await detail(first, bob.cookie);
    expect(closed.request).toMatchObject({ status: "closed", closeReason: "rejected", decidedBy: "carol" });
    expect(closed.events.at(-1)).toMatchObject({ kind: "rejected", body: "wrong region" });
    expect((await apply(plan, bob.cookie)).body.error.code).toBe("request_needed");
    // a rejected plan can be sent again: a new request, #2
    const second = await send(plan);
    expect(second.body.request.number).toBe(2);
    expect((await act(second.body.request.id, "withdraw", carol.cookie)).status).toBe(403);
    expect((await act(second.body.request.id, "withdraw", bob.cookie)).status).toBe(200);
    expect((await detail(second.body.request.id, bob.cookie)).request).toMatchObject({ status: "closed", closeReason: "withdrawn" });
    expect((await act(second.body.request.id, "withdraw", bob.cookie)).body.error.code).toBe("not_open");
    expect((await act(second.body.request.id, "approve", alice.cookie)).body.error.code).toBe("not_waiting");
  });

  it("shows a request as out of date when the design moves on, and takes a newer plan into the same request", async () => {
    const pid = await newProject("replan");
    const plan1 = await planned(pid);
    const reqId = (await send(plan1)).body.request.id as string;
    expect((await act(reqId, "approve", alice.cookie)).status).toBe(200);
    const proj = (await t.call("GET", `/api/projects/${pid}`, { cookie: alice.cookie })).body.project;
    const changed = structuredClone(proj.design);
    changed.nodes.push({ key: "extra_bucket", label: "extra", service: "s3", props: { bucket: "extra-bucket-for-test" } });
    await t.call("PUT", `/api/projects/${pid}`, { cookie: alice.cookie, body: { design: changed, baseRev: proj.rev } });
    const stale = await detail(reqId, bob.cookie);
    expect(stale.apply.stale).toEqual(["design_changed"]);
    expect((await apply(plan1, bob.cookie)).body.error.code).toBe("design_changed");

    const plan2 = await planned(pid);
    expect((await run(plan2, bob.cookie)).replaceable).toEqual([{ id: reqId, number: 1 }]);
    expect((await detail(reqId, bob.cookie)).newerPlans.map((p: { id: string }) => p.id)).toEqual([plan2]);
    expect((await act(reqId, "replan", carol.cookie, { planRunId: plan2 })).status).toBe(403);
    expect((await act(reqId, "replan", bob.cookie, { planRunId: plan1 })).body.error.code).toBe("design_changed");
    expect((await act(reqId, "replan", bob.cookie, { planRunId: plan2 })).status).toBe(200);
    const after = await detail(reqId, bob.cookie);
    expect(after.request).toMatchObject({ status: "waiting", planRunId: plan2, decidedBy: null });
    expect(after.apply.stale).toEqual([]);
    expect(kinds(after)).toEqual(["requested", "approved", "replanned"]);
    expect((await run(plan1, bob.cookie)).request).toBeNull();
    expect((await run(plan2, bob.cookie)).request).toMatchObject({ number: 1, status: "waiting" });
  });

  it("lets the owner apply at once, without a request, even a plan a member made, and tells a waiting request when that finishes", async () => {
    const pid = await newProject("direct");
    const plan = await planned(pid);
    expect((await run(plan, alice.cookie)).can).toMatchObject({ applyNow: true, request: false });
    const reqId = (await send(plan)).body.request.id as string;
    expect((await apply(plan, alice.cookie)).status).toBe(201);
    await finish();
    const d = await detail(reqId, bob.cookie);
    expect(d.request.status).toBe("applied");
    expect(kinds(d).at(-1)).toBe("applied");
  });

  it("notes a failed apply in the request, which stays approved", async () => {
    const pid = await newProject("apply-fails");
    const plan = await planned(pid);
    const reqId = (await send(plan)).body.request.id as string;
    await act(reqId, "approve", alice.cookie);
    expect((await apply(plan, bob.cookie)).status).toBe(201);
    await finish("fake-tofu-errored.sh");
    const d = await detail(reqId, bob.cookie);
    expect(d.request.status).toBe("approved");
    expect(d.events.at(-1)).toMatchObject({ kind: "apply_failed" });
  });

  it("keeps the others out and needs a person's session to decide", async () => {
    const pid = await newProject("private");
    const plan = await planned(pid);
    const reqId = (await send(plan)).body.request.id as string;
    expect((await t.call("GET", "/api/requests?scope=mine", { cookie: dave.cookie })).body.requests).toEqual([]);
    expect((await t.call("GET", `/api/requests?scope=project&projectId=${pid}`, { cookie: dave.cookie })).body.requests).toEqual([]);
    expect((await t.call("GET", `/api/requests?scope=project&projectId=${pid}`, { cookie: carol.cookie })).body.requests).toHaveLength(1);
    expect((await t.call("GET", "/api/requests?scope=project", { cookie: carol.cookie })).status).toBe(400);
    const made = await t.call("POST", "/api/tokens", { cookie: alice.cookie, body: { name: "ci" } });
    const bearer = (method: string, url: string, body?: unknown) => t.call(method, url, { csrf: false, headers: { authorization: `Bearer ${made.body.secret}` }, ...(body !== undefined ? { body } : {}) });
    expect((await bearer("POST", `/api/requests/${reqId}/approve`, {})).body.error.code).toBe("session_required");
    expect((await detail(reqId, alice.cookie)).request.status).toBe("waiting");
  });
});

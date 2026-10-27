import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, fakeAws, postgresAvailable, SERVER_ARN, testApp, type TestApp } from "./helpers.ts";
import { claim } from "../src/runs/queue.ts";
import { execute } from "../src/runs/runner.ts";

const available = await postgresAvailable();
const design = JSON.parse(readFileSync(join(import.meta.dirname, "../../../packages/testkit/designs/ec2-in-vpc.json"), "utf8"));
const PLAN = "arn:aws:iam::123456789012:role/av2i-plan";
const APPLY = "arn:aws:iam::123456789012:role/av2i-apply";

describe.skipIf(!available)("AWS connections", () => {
  const aws = fakeAws({ deny: { "arn:aws:iam::123456789012:role/nope": "trust" } });
  let t: TestApp;
  let admin: string;
  let alice: { id: string; cookie: string };
  let user: { id: string; cookie: string };
  let nobody: { id: string; cookie: string };
  let projectId: string;
  let connId: string;

  const policyFor = async (userId: string, name: string, actions: string[], res: string) => {
    const p = await t.db.insertInto("policies").values({ name, document: JSON.stringify({ Statement: [{ Effect: "Allow", Action: actions, Resource: [res] }] }) }).returning("id").executeTakeFirstOrThrow();
    await t.db.insertInto("policy_attachments").values({ policy_id: p.id, user_id: userId, group_id: null }).execute();
    return p.id;
  };
  const create = (cookie: string, body: object) => t.call("POST", "/api/connections", { cookie, body });
  const plan = (cookie: string) => t.call("POST", `/api/projects/${projectId}/runs`, { cookie, body: { kind: "plan" } });

  beforeAll(async () => {
    t = await testApp({ tofuBin: join(import.meta.dirname, "fake-tofu.sh") }, aws);
    admin = await t.admin();
    alice = await addMember(t, admin, "alice", ["ProjectEditor"]);
    user = await addMember(t, admin, "uma");
    nobody = await addMember(t, admin, "nora");
    projectId = (await t.call("POST", "/api/projects", { cookie: alice.cookie, body: { design } })).body.project.id;
  });
  afterAll(async () => { await t.close(); });

  it("lets only a manager create, and checks names and role ARNs", async () => {
    expect((await create(alice.cookie, { name: "prod", planRoleArn: PLAN })).status).toBe(403);
    expect((await create(admin, { name: "p", planRoleArn: PLAN })).body.error.code).toBe("invalid_name");
    expect((await create(admin, { name: "prod", planRoleArn: "arn:aws:iam::123456789012:user/x" })).body.error.code).toBe("invalid_role_arn");
    expect((await create(admin, { name: "prod", planRoleArn: PLAN, applyRoleArn: "arn:aws:iam::999999999999:role/apply" })).body.error.code).toBe("accounts_differ");
    const ok = await create(admin, { name: "prod", description: "production account", planRoleArn: PLAN, applyRoleArn: APPLY });
    expect(ok.status).toBe(201);
    connId = ok.body.connection.id;
    expect(ok.body.connection).toMatchObject({ name: "prod", account: "123456789012", planOnly: false });
    expect((await create(admin, { name: "PROD", planRoleArn: PLAN })).body.error.code).toBe("name_taken");
  });

  it("shows the ARNs only to a manager, and a person who may only use it gets the brief view", async () => {
    await policyFor(user.id, "UseProd", ["connection:Use"], `av2i:connection/${connId}`);
    expect((await t.call("GET", "/api/connections", { cookie: nobody.cookie })).body.connections).toEqual([]);
    const brief = (await t.call("GET", "/api/connections", { cookie: user.cookie })).body.connections;
    expect(brief).toEqual([{ view: "brief", id: connId, name: "prod", description: "production account", account: "123456789012", planOnly: false }]);
    const all = (await t.call("GET", "/api/connections", { cookie: admin })).body.connections[0];
    expect(all).toMatchObject({ view: "full", planRoleArn: PLAN, applyRoleArn: APPLY, projects: 0 });
    expect(JSON.stringify(brief)).not.toContain("externalId");
    expect((await t.call("GET", `/api/connections/${connId}`, { cookie: nobody.cookie })).status).toBe(404);
    expect((await t.call("GET", `/api/connections/${connId}`, { cookie: user.cookie })).status).toBe(403);
  });

  it("gives a manager the ExternalId, a trust policy for this server and a read-only plan policy", async () => {
    const d = (await t.call("GET", `/api/connections/${connId}`, { cookie: admin })).body;
    expect(d.connection.externalId).toMatch(/^[0-9a-f]{64}$/);
    expect(d.server).toMatchObject({ ok: true, arn: SERVER_ARN, principal: "arn:aws:iam::111122223333:role/av2i-server", pathWarning: true });
    const trust = JSON.parse(d.trustPolicy);
    expect(trust.Statement[0].Condition.StringEquals["sts:ExternalId"]).toBe(d.connection.externalId);
    expect(trust.Statement[0].Principal.AWS).toBe("arn:aws:iam::111122223333:role/av2i-server");
    expect(JSON.parse(d.planPolicy).Statement[0].Action).toContain("ec2:Describe*");
    expect((await t.call("GET", "/api/server-identity", { cookie: user.cookie })).status).toBe(403);
    expect((await t.call("GET", "/api/server-identity", { cookie: admin })).body).toMatchObject({ ok: true, principal: "arn:aws:iam::111122223333:role/av2i-server" });
  });

  it("tests each role by assuming it, keeps the answer, and forgets it when a role changes", async () => {
    expect((await t.call("POST", `/api/connections/${connId}/test`, { cookie: user.cookie })).status).toBe(403);
    const ok = (await t.call("POST", `/api/connections/${connId}/test`, { cookie: admin })).body;
    expect(ok.result.plan).toMatchObject({ ok: true, account: "999988887777" });
    expect(ok.result.apply.ok).toBe(true);
    expect(aws.calls.assume.at(-1)!.externalId).toMatch(/^[0-9a-f]{64}$/);
    const stored = (await t.call("GET", "/api/connections", { cookie: admin })).body.connections[0];
    expect(stored.lastTest.plan.ok).toBe(true);
    const bad = await t.call("PATCH", `/api/connections/${connId}`, { cookie: admin, body: { applyRoleArn: "arn:aws:iam::123456789012:role/nope" } });
    expect(bad.body.connection.lastTest).toBeNull();
    const denied = (await t.call("POST", `/api/connections/${connId}/test`, { cookie: admin })).body.result;
    expect(denied.plan.ok).toBe(true);
    expect(denied.apply).toMatchObject({ ok: false, code: "trust" });
    await t.call("PATCH", `/api/connections/${connId}`, { cookie: admin, body: { applyRoleArn: null } });
    expect((await t.call("POST", `/api/connections/${connId}/test`, { cookie: admin })).body.result.apply).toBeNull();
  });

  it("makes a project choose a connection it may use, and refuses a plan without one or without the right to use it", async () => {
    expect((await plan(alice.cookie)).body.error.code).toBe("no_connection");
    expect((await t.call("PUT", `/api/projects/${projectId}/connection`, { cookie: alice.cookie, body: { connectionId: connId } })).body.error.code).toBe("no_such_connection");
    await policyFor(alice.id, "AliceUsesProd", ["connection:Use"], `av2i:connection/${connId}`);
    expect((await t.call("PUT", `/api/projects/${projectId}/connection`, { cookie: alice.cookie, body: { connectionId: connId } })).status).toBe(200);
    expect((await t.call("GET", `/api/projects/${projectId}`, { cookie: alice.cookie })).body.project.connection).toEqual({ id: connId, name: "prod" });
    expect((await plan(alice.cookie)).status).toBe(201);
  });

  it("assumes the plan role for a run and gives tofu only the temporary keys", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIASERVERKEY0000000";
    process.env.AWS_SECRET_ACCESS_KEY = "server-secret-value-do-not-leak";
    try {
      await t.db.updateTable("runs").set({ status: "cancelled" }).where("status", "=", "queued").execute();
      const r = await plan(alice.cookie);
      const c = await claim(t.db);
      expect(c?.id).toBe(r.body.run.id);
      await execute(t.db, t.config, c!, aws);
      const logs = (await t.call("GET", `/api/runs/${r.body.run.id}/logs`, { cookie: alice.cookie })).body.lines.map((l: { line: string }) => l.line).join("\n");
      expect(logs).toContain(`Assumed ${PLAN} as session av2i-alice-${r.body.run.id.slice(0, 8)}`);
      expect(logs).toContain("key:ASIA****************");
      expect(logs).not.toContain("AKIASERVERKEY0000000");
      expect(logs).not.toContain("server-secret-value-do-not-leak");
      expect(logs).not.toContain("fake-secret-access-key-value");
      expect(logs).not.toContain("fake-session-token-value");
      const row = await t.db.selectFrom("runs").select(["status", "connection_id", "role_arn", "aws_account"]).where("id", "=", r.body.run.id).executeTakeFirstOrThrow();
      expect(row).toMatchObject({ status: "succeeded", connection_id: connId, role_arn: PLAN, aws_account: "123456789012" });
    } finally {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
    }
  });

  it("fails the run with the reason when the role does not let the server in", async () => {
    await t.call("PATCH", `/api/connections/${connId}`, { cookie: admin, body: { planRoleArn: "arn:aws:iam::123456789012:role/nope" } });
    const r = await plan(alice.cookie);
    await execute(t.db, t.config, (await claim(t.db))!, aws);
    const run = (await t.call("GET", `/api/runs/${r.body.run.id}`, { cookie: alice.cookie })).body.run;
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/did not let this server in/);
    await t.call("PATCH", `/api/connections/${connId}`, { cookie: admin, body: { planRoleArn: PLAN } });
  });

  it("answers preflight with the assumed role and refuses it to someone who may not use the connection", async () => {
    const p = (await t.call("GET", `/api/projects/${projectId}/preflight`, { cookie: alice.cookie })).body;
    expect(p.identity).toMatchObject({ ok: true, via: "role", roleArn: PLAN, account: "999988887777" });
    expect(p.connection).toMatchObject({ name: "prod", planOnly: true });
    await t.db.deleteFrom("policy_attachments").where("user_id", "=", alice.id).execute();
    expect((await t.call("GET", `/api/projects/${projectId}/preflight`, { cookie: alice.cookie })).body.identity).toMatchObject({ ok: false, reason: "forbidden" });
    expect((await plan(alice.cookie)).body.error.code).toBe("connection_forbidden");
  });

  it("cannot delete a connection a project uses, and audits without any key", async () => {
    expect((await t.call("DELETE", `/api/connections/${connId}`, { cookie: user.cookie })).status).toBe(403);
    expect((await t.call("DELETE", `/api/connections/${connId}`, { cookie: admin })).body.error.code).toBe("connection_in_use");
    await t.db.updateTable("projects").set({ connection_id: null }).where("id", "=", projectId).execute();
    expect((await t.call("DELETE", `/api/connections/${connId}`, { cookie: admin })).status).toBe(200);
    const log = JSON.stringify(await t.db.selectFrom("audit_log").select(["action", "details"]).where("action", "like", "connection.%").execute());
    expect(log).toContain("connection.created");
    expect(log).toContain("connection.deleted");
    expect(log).not.toMatch(/fake-secret|fake-session|ASIA/);
  });
});

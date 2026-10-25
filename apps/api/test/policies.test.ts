import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, postgresAvailable, testApp, type TestApp } from "./helpers.ts";

const available = await postgresAvailable();

const doc = (effect: "Allow" | "Deny", actions: string[], resources = ["*"]) => ({ Statement: [{ Sid: "s1", Effect: effect, Action: actions, Resource: resources }] });

describe.skipIf(!available)("policies", () => {
  let t: TestApp;
  let admin: string;
  beforeAll(async () => { t = await testApp(); admin = await t.admin(); });
  afterAll(async () => { await t.close(); });

  const create = (name: string, document: unknown, extra: object = {}) => t.call("POST", "/api/policies", { cookie: admin, body: { name, document, ...extra } });
  const attach = (userId: string, names: string[]) => t.call("PUT", `/api/users/${userId}/policies`, { cookie: admin, body: { policies: names } });

  it("lists the built-in policies with how many users and groups hold them", async () => {
    const r = await t.call("GET", "/api/policies", { cookie: admin });
    expect(r.status).toBe(200);
    const names = r.body.policies.map((p: any) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Administrator", "ProjectEditor", "ProjectViewer", "UserManager"]));
    expect(r.body.policies.find((p: any) => p.name === "Administrator")).toMatchObject({ builtin: true, users: 1, groups: 0 });
    const nobody = await addMember(t, admin, "nobody");
    expect((await t.call("GET", "/api/policies", { cookie: nobody.cookie })).status).toBe(403);
  });

  it("creates a policy, reads it back with who holds it, and refuses a bad name or a taken one", async () => {
    const r = await create("AuditReader", doc("Allow", ["audit:Read"], ["av2i:audit/*"]), { description: "Reads the log" });
    expect(r.status).toBe(201);
    const u = await addMember(t, admin, "reader");
    await attach(u.id, ["AuditReader"]);
    const got = await t.call("GET", "/api/policies/AuditReader", { cookie: admin });
    expect(got.body.policy).toMatchObject({ name: "AuditReader", builtin: false, description: "Reads the log" });
    expect(got.body.users.map((x: any) => x.username)).toEqual(["reader"]);
    expect((await create("x", doc("Allow", ["audit:Read"]))).body.error.code).toBe("invalid_policy_name");
    expect((await create("auditreader", doc("Allow", ["audit:Read"]))).body.error.code).toBe("policy_taken");
  });

  it("says what is wrong with a document instead of storing it", async () => {
    const r = await create("Broken", { Statement: [{ Effect: "Maybe", Action: ["project:Reed"], Resource: ["arn:aws:s3:::x"] }] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("invalid_policy");
    expect(r.body.error.problems.join("\n")).toContain("Effect");
    expect(r.body.error.problems.join("\n")).toContain("matches no known action");
    expect((await create("Empty", { Statement: [] })).body.error.code).toBe("invalid_policy");
    const big = { Statement: [{ Effect: "Allow", Action: ["audit:Read"], Resource: Array.from({ length: 3000 }, (_, i) => `av2i:project/${"x".repeat(30)}${i}`) }] };
    expect((await create("TooBig", big)).body.error.code).toBe("policy_too_large");
  });

  it("takes effect the moment it is attached, changed or removed", async () => {
    await create("LogViewer", doc("Allow", ["audit:Read"], ["av2i:audit/*"]));
    const u = await addMember(t, admin, "watcher");
    expect((await t.call("GET", "/api/audit", { cookie: u.cookie })).status).toBe(403);
    await attach(u.id, ["LogViewer"]);
    expect((await t.call("GET", "/api/audit", { cookie: u.cookie })).status).toBe(200);
    const changed = await t.call("PUT", "/api/policies/LogViewer", { cookie: admin, body: { document: doc("Allow", ["project:Read"]) } });
    expect(changed.status).toBe(200);
    expect((await t.call("GET", "/api/audit", { cookie: u.cookie })).status).toBe(403);
    await t.call("PUT", "/api/policies/LogViewer", { cookie: admin, body: { document: doc("Allow", ["audit:Read"], ["av2i:audit/*"]) } });
    expect((await t.call("GET", "/api/audit", { cookie: u.cookie })).status).toBe(200);
    await attach(u.id, []);
    expect((await t.call("GET", "/api/audit", { cookie: u.cookie })).status).toBe(403);
  });

  it("does not let a built-in policy be changed or deleted", async () => {
    const put = await t.call("PUT", "/api/policies/Administrator", { cookie: admin, body: { description: "x" } });
    expect(put.status).toBe(409);
    expect(put.body.error.code).toBe("builtin_policy");
    expect((await t.call("DELETE", "/api/policies/ProjectViewer", { cookie: admin })).body.error.code).toBe("builtin_policy");
    expect((await t.call("GET", "/api/policies/Nope", { cookie: admin })).status).toBe(404);
  });

  it("asks for force to delete a policy that is attached, and detaches it when forced", async () => {
    await create("Temp", doc("Allow", ["audit:Read"], ["av2i:audit/*"]));
    const u = await addMember(t, admin, "tempuser");
    await attach(u.id, ["Temp"]);
    const refused = await t.call("DELETE", "/api/policies/Temp", { cookie: admin });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: "policy_in_use", users: 1, groups: 0 });
    expect((await t.call("GET", "/api/audit", { cookie: u.cookie })).status).toBe(200);
    expect((await t.call("DELETE", "/api/policies/Temp?force=true", { cookie: admin })).status).toBe(200);
    expect((await t.call("GET", "/api/audit", { cookie: u.cookie })).status).toBe(403);
    expect((await t.call("GET", "/api/policies/Temp", { cookie: admin })).status).toBe(404);
  });

  it("simulates what a person's policies decide, and which statement decided", async () => {
    await create("DenyAudit", { Statement: [{ Sid: "no-log", Effect: "Deny", Action: ["audit:Read"], Resource: ["*"] }] });
    const u = await addMember(t, admin, "sim", ["Administrator"]);
    await attach(u.id, ["Administrator", "DenyAudit"]);
    const ask = (action: string, resource: string, userId = u.id) => t.call("POST", "/api/policies/simulate", { cookie: admin, body: { userId, action, resource } });
    expect((await ask("project:Read", "av2i:project/p1")).body).toEqual({ allowed: true, reason: "allow", sid: "all" });
    expect((await ask("audit:Read", "av2i:audit/*")).body).toEqual({ allowed: false, reason: "explicit-deny", sid: "no-log" });
    const plain = await addMember(t, admin, "plain");
    expect((await ask("project:Read", "av2i:project/p1", plain.id)).body).toEqual({ allowed: false, reason: "implicit-deny" });
    expect((await ask("project:Nope", "av2i:project/p1")).body.error.code).toBe("unknown_action");
    expect((await t.call("POST", "/api/policies/simulate", { cookie: plain.cookie, body: { userId: u.id, action: "project:Read", resource: "av2i:project/p1" } })).status).toBe(403);
  });

  it("audits creating, changing and deleting", async () => {
    await create("Logged", doc("Allow", ["audit:Read"]));
    await t.call("PUT", "/api/policies/Logged", { cookie: admin, body: { description: "x" } });
    await t.call("DELETE", "/api/policies/Logged", { cookie: admin });
    const rows = await t.db.selectFrom("audit_log").select("action").where("resource", "=", "av2i:policy/Logged").orderBy("id").execute();
    expect(rows.map((r) => r.action)).toEqual(["policy.created", "policy.updated", "policy.deleted"]);
  });
});

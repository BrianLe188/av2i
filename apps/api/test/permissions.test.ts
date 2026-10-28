import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, postgresAvailable, testApp, type TestApp } from "./helpers.ts";

const available = await postgresAvailable();

describe.skipIf(!available)("direct permissions and the table of effective permissions (DD-030)", () => {
  let t: TestApp;
  let admin: string;
  let ula: { id: string; cookie: string };
  let group: string;

  beforeAll(async () => {
    t = await testApp();
    admin = await t.admin();
    ula = await addMember(t, admin, "ula");
    group = (await t.call("POST", "/api/groups", { cookie: admin, body: { name: "hr" } })).body.group.id;
  });
  afterAll(async () => { await t.close(); });

  const giveUser = (id: string, body: object, cookie = admin) => t.call("PUT", `/api/users/${id}/direct-permissions`, { cookie, body });
  const giveGroup = (id: string, body: object, cookie = admin) => t.call("PUT", `/api/groups/${id}/direct-permissions`, { cookie, body });
  const row = (rows: any[], action: string) => rows.find((r) => r.action === action);

  it("gives a user permissions straight, with no policy, and takes them back", async () => {
    expect((await t.call("GET", "/api/audit", { cookie: ula.cookie })).status).toBe(403);
    expect((await giveUser(ula.id, { all: false, actions: ["audit:Read"] })).status).toBe(200);
    expect((await t.call("GET", "/api/audit", { cookie: ula.cookie })).status).toBe(200);
    expect((await t.call("GET", `/api/users/${ula.id}/permissions`, { cookie: admin })).body.direct).toEqual({ all: false, actions: ["audit:Read"] });
    expect((await giveUser(ula.id, { all: false, actions: [] })).status).toBe(200);
    expect((await t.call("GET", "/api/audit", { cookie: ula.cookie })).status).toBe(403);
    expect((await t.call("GET", `/api/users/${ula.id}/permissions`, { cookie: admin })).body.direct).toEqual({ all: false, actions: [] });
  });

  it("gives a group permissions that reach its members, and 'all' is every permission", async () => {
    await t.call("PUT", `/api/groups/${group}/members`, { cookie: admin, body: { userIds: [ula.id] } });
    expect((await giveGroup(group, { all: false, actions: ["audit:Read", "project:Create"] })).status).toBe(200);
    expect((await t.call("GET", "/api/audit", { cookie: ula.cookie })).status).toBe(200);
    expect((await t.call("GET", "/api/policies", { cookie: ula.cookie })).status).toBe(403);
    expect((await giveGroup(group, { all: true, actions: [] })).status).toBe(200);
    expect((await t.call("GET", "/api/policies", { cookie: ula.cookie })).status).toBe(200);
    expect((await t.call("GET", `/api/groups/${group}/permissions`, { cookie: admin })).body.direct).toMatchObject({ all: true });
    expect((await giveGroup(group, { all: false, actions: [] })).status).toBe(200);
    expect((await t.call("GET", "/api/policies", { cookie: ula.cookie })).status).toBe(403);
  });

  it("says for every permission whether it is allowed, by which policy, group or direct grant, and what a Deny or a scope does", async () => {
    await t.call("PUT", `/api/users/${ula.id}/policies`, { cookie: admin, body: { policies: ["ProjectViewer"] } });
    await t.call("PUT", `/api/groups/${group}/policies`, { cookie: admin, body: { policies: ["UserManager"] } });
    await giveUser(ula.id, { all: false, actions: ["audit:Read"] });
    await t.call("POST", "/api/policies", { cookie: admin, body: { name: "OddRules", document: { Statement: [
      { Effect: "Allow", Action: ["project:Write"], Resource: ["av2i:project/abc"] },
      { Effect: "Allow", Action: ["project:Delete"], Resource: ["av2i:project/*"] },
      { Effect: "Deny", Action: ["project:Delete"], Resource: ["av2i:project/*"] },
    ] } } });
    await t.call("PUT", `/api/users/${ula.id}/policies`, { cookie: admin, body: { policies: ["ProjectViewer", "OddRules"] } });
    const e = (await t.call("GET", `/api/users/${ula.id}/permissions`, { cookie: admin })).body.effective as any[];
    expect(e).toHaveLength(24);
    expect(row(e, "project:Read")).toMatchObject({ allowed: true, denied: false, sources: [{ kind: "policy", name: "ProjectViewer", scoped: false }] });
    expect(row(e, "user:List")).toMatchObject({ allowed: true, sources: [{ kind: "policy", name: "UserManager", group: "hr", scoped: false }] });
    expect(row(e, "audit:Read")).toMatchObject({ allowed: true, sources: [{ kind: "direct", name: "", scoped: false }] });
    expect(row(e, "run:Plan")).toMatchObject({ allowed: false, denied: false, sources: [] });
    // allowed on one project only: listed as a source, but not allowed everywhere
    expect(row(e, "project:Write")).toMatchObject({ allowed: false, sources: [{ name: "OddRules", scoped: true }] });
    // an explicit Deny wins over an Allow
    expect(row(e, "project:Delete")).toMatchObject({ allowed: false, denied: true });
    // the group's own table has no user policy in it
    const g = (await t.call("GET", `/api/groups/${group}/permissions`, { cookie: admin })).body.effective as any[];
    expect(row(g, "user:List").sources).toEqual([{ kind: "policy", name: "UserManager", scoped: false }]);
    expect(row(g, "project:Read").allowed).toBe(false);
  });

  it("needs policy:Manage and a person's session, and refuses a permission that does not exist", async () => {
    const manager = await addMember(t, admin, "mona", ["UserManager"]);
    expect((await t.call("GET", `/api/users/${ula.id}/permissions`, { cookie: manager.cookie })).status).toBe(403);
    expect((await giveUser(ula.id, { all: false, actions: ["audit:Read"] }, manager.cookie)).status).toBe(403);
    expect((await giveUser(ula.id, { all: false, actions: ["nope:Nothing"] })).status).toBe(400);
    expect((await t.call("GET", "/api/users/00000000-0000-4000-8000-000000000000/permissions", { cookie: admin })).status).toBe(404);
    const made = await t.call("POST", "/api/tokens", { cookie: admin, body: { name: "ci" } });
    const bearer = (method: string, url: string, body?: unknown) => t.call(method, url, { csrf: false, headers: { authorization: `Bearer ${made.body.secret}` }, ...(body !== undefined ? { body } : {}) });
    expect((await bearer("PUT", `/api/users/${ula.id}/direct-permissions`, { all: true, actions: [] })).body.error.code).toBe("session_required");
  });

  it("audits who gave what, and drops the permissions with the user", async () => {
    const log = await t.db.selectFrom("audit_log").select(["action", "details"]).where("action", "in", ["user.direct_permissions_set", "group.direct_permissions_set"]).execute();
    expect(log.length).toBeGreaterThan(3);
    expect(JSON.stringify(log)).toContain("audit:Read");
    const gone = await addMember(t, admin, "gone");
    await giveUser(gone.id, { all: false, actions: ["audit:Read"] });
    expect(await t.db.selectFrom("direct_permissions").select("id").where("user_id", "=", gone.id).execute()).toHaveLength(1);
    await t.db.deleteFrom("users").where("id", "=", gone.id).execute();
    expect(await t.db.selectFrom("direct_permissions").select("id").where("user_id", "=", gone.id).execute()).toHaveLength(0);
  });
});

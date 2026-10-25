import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, postgresAvailable, testApp, type TestApp } from "./helpers.ts";

const available = await postgresAvailable();

describe.skipIf(!available)("groups", () => {
  let t: TestApp;
  let admin: string;
  let adminId: string;
  beforeAll(async () => {
    t = await testApp();
    admin = await t.admin();
    adminId = (await t.call("GET", "/api/auth/me", { cookie: admin })).body.user.id;
  });
  afterAll(async () => { await t.close(); });

  const group = async (name: string, extra: object = {}) => {
    const r = await t.call("POST", "/api/groups", { cookie: admin, body: { name, ...extra } });
    expect(r.status).toBe(201);
    return r.body.group.id as string;
  };
  const members = (id: string, userIds: string[], cookie = admin) => t.call("PUT", `/api/groups/${id}/members`, { cookie, body: { userIds } });
  const policies = (id: string, names: string[], cookie = admin) => t.call("PUT", `/api/groups/${id}/policies`, { cookie, body: { policies: names } });

  it("needs group:Manage, which a person without it does not have", async () => {
    const nobody = await addMember(t, admin, "nobody");
    expect((await t.call("GET", "/api/groups", { cookie: nobody.cookie })).status).toBe(403);
    expect((await t.call("POST", "/api/groups", { cookie: nobody.cookie, body: { name: "x1" } })).status).toBe(403);
    const manager = await addMember(t, admin, "manager", ["UserManager"]);
    expect((await t.call("POST", "/api/groups", { cookie: manager.cookie, body: { name: "by-manager" } })).status).toBe(201);
  });

  it("creates a group with a lowercase name, and refuses a bad or a taken one", async () => {
    const r = await t.call("POST", "/api/groups", { cookie: admin, body: { name: "Builders", description: "The people who build" } });
    expect(r.status).toBe(201);
    expect(r.body.group.name).toBe("builders");
    expect((await t.call("POST", "/api/groups", { cookie: admin, body: { name: "x" } })).body.error.code).toBe("invalid_group_name");
    expect((await t.call("POST", "/api/groups", { cookie: admin, body: { name: "has space" } })).body.error.code).toBe("invalid_group_name");
    expect((await t.call("POST", "/api/groups", { cookie: admin, body: { name: "BUILDERS" } })).body.error.code).toBe("group_taken");
  });

  it("gives its members what its policies allow, at once, and takes it away when they leave", async () => {
    const mia = await addMember(t, admin, "mia");
    const id = await group("helpers");
    expect((await t.call("GET", "/api/users", { cookie: mia.cookie })).status).toBe(403);
    expect((await policies(id, ["UserManager"])).status).toBe(200);
    expect((await t.call("GET", "/api/users", { cookie: mia.cookie })).status).toBe(403);
    expect((await members(id, [mia.id])).status).toBe(200);
    expect((await t.call("GET", "/api/users", { cookie: mia.cookie })).status).toBe(200);
    expect((await t.call("GET", "/api/auth/me", { cookie: mia.cookie })).body.actions).toContain("user:Create");
    expect((await members(id, [])).status).toBe(200);
    expect((await t.call("GET", "/api/users", { cookie: mia.cookie })).status).toBe(403);
  });

  it("shows members, policies and the groups of each user", async () => {
    const lee = await addMember(t, admin, "lee");
    const id = await group("viewers");
    await policies(id, ["ProjectViewer"]);
    await members(id, [lee.id]);
    const detail = await t.call("GET", `/api/groups/${id}`, { cookie: admin });
    expect(detail.body.members.map((m: any) => m.username)).toEqual(["lee"]);
    expect(detail.body.policies).toEqual(["ProjectViewer"]);
    const list = await t.call("GET", "/api/groups", { cookie: admin });
    expect(list.body.groups.find((g: any) => g.id === id)).toMatchObject({ members: 1, policies: ["ProjectViewer"] });
    const users = await t.call("GET", "/api/users", { cookie: admin });
    expect(users.body.users.find((u: any) => u.username === "lee").groups).toEqual(["viewers"]);
  });

  it("needs policy:Manage to attach a policy to a group, and refuses an unknown user or policy", async () => {
    const manager = await addMember(t, admin, "gm", ["UserManager"]);
    const id = await group("guarded");
    expect((await policies(id, ["ProjectViewer"], manager.cookie)).status).toBe(403);
    expect((await policies(id, ["Nope"])).body.error.code).toBe("unknown_policy");
    expect((await members(id, ["00000000-0000-4000-8000-000000000000"])).body.error.code).toBe("unknown_user");
  });

  it("keeps an administrator whatever way a group is changed", async () => {
    const jules = await addMember(t, admin, "jules");
    const g = await group("admins");
    await policies(g, ["Administrator"]);
    expect((await members(g, [jules.id])).status).toBe(200);
    // admin holds Administrator directly: it can be removed while jules holds it through the group
    expect((await t.call("PUT", `/api/users/${adminId}/policies`, { cookie: admin, body: { policies: [] } })).status).toBe(200);

    const before = (await t.call("GET", `/api/groups/${g}`, { cookie: jules.cookie })).body;
    for (const attempt of [
      () => members(g, [], jules.cookie),
      () => policies(g, [], jules.cookie),
      () => t.call("DELETE", `/api/groups/${g}`, { cookie: jules.cookie }),
    ]) {
      const r = await attempt();
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("last_administrator");
    }
    const after = (await t.call("GET", `/api/groups/${g}`, { cookie: jules.cookie })).body;
    expect(after.members).toEqual(before.members);
    expect(after.policies).toEqual(before.policies);
    // and with the direct policy given back, the group can go
    expect((await t.call("PUT", `/api/users/${adminId}/policies`, { cookie: jules.cookie, body: { policies: ["Administrator"] } })).status).toBe(200);
    expect((await t.call("DELETE", `/api/groups/${g}`, { cookie: admin })).status).toBe(200);
    expect((await t.call("GET", "/api/auth/me", { cookie: jules.cookie })).body.actions).toEqual([]);
  });

  it("deletes a group and with it the access it gave", async () => {
    const ned = await addMember(t, admin, "ned");
    const id = await group("temp");
    await policies(id, ["UserManager"]);
    await members(id, [ned.id]);
    expect((await t.call("GET", "/api/users", { cookie: ned.cookie })).status).toBe(200);
    expect((await t.call("DELETE", `/api/groups/${id}`, { cookie: admin })).status).toBe(200);
    expect((await t.call("GET", "/api/users", { cookie: ned.cookie })).status).toBe(403);
    expect((await t.call("GET", `/api/groups/${id}`, { cookie: admin })).status).toBe(404);
  });

  it("audits what changed", async () => {
    const id = await group("audited");
    await members(id, [adminId]);
    await policies(id, ["ProjectViewer"]);
    await t.call("DELETE", `/api/groups/${id}`, { cookie: admin });
    const rows = await t.db.selectFrom("audit_log").select("action").where("resource", "=", `av2i:group/${id}`).orderBy("id").execute();
    expect(rows.map((r) => r.action)).toEqual(["group.created", "group.members_set", "group.policies_set", "group.deleted"]);
  });
});

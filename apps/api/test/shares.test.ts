import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, blankDesign, postgresAvailable, testApp, type TestApp } from "./helpers.ts";

const available = await postgresAvailable();

describe.skipIf(!available)("project shares", () => {
  let t: TestApp;
  let admin: string;
  let alice: { id: string; cookie: string };
  let bob: { id: string; cookie: string };
  let carol: { id: string; cookie: string };
  let project: string;

  beforeAll(async () => {
    t = await testApp();
    admin = await t.admin();
    alice = await addMember(t, admin, "alice", ["ProjectEditor"]);
    bob = await addMember(t, admin, "bob");
    carol = await addMember(t, admin, "carol");
    project = (await t.call("POST", "/api/projects", { cookie: alice.cookie, body: { design: blankDesign("Shared") } })).body.project.id;
  });
  afterAll(async () => { await t.close(); });

  const put = (cookie: string, body: object, id = project) => t.call("PUT", `/api/projects/${id}/shares`, { cookie, body });
  const list = (cookie: string, id = project) => t.call("GET", `/api/projects/${id}/shares`, { cookie });

  it("lets the owner share with a user, who can then read but not write on a viewer share", async () => {
    expect((await t.call("GET", `/api/projects/${project}`, { cookie: bob.cookie })).status).toBe(404);
    expect((await put(alice.cookie, { user: "bob", role: "viewer" })).status).toBe(200);
    const read = await t.call("GET", `/api/projects/${project}`, { cookie: bob.cookie });
    expect(read.status).toBe(200);
    expect(read.body.can).toMatchObject({ write: false, share: false });
    const write = await t.call("PUT", `/api/projects/${project}`, { cookie: bob.cookie, body: { design: blankDesign("Shared"), baseRev: 1 } });
    expect(write.status).toBe(403);
  });

  it("changes the role of an existing share instead of adding a second one", async () => {
    await put(alice.cookie, { user: "bob", role: "editor" });
    const shares = (await list(alice.cookie)).body.shares;
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ kind: "user", name: "bob", role: "editor", grantedBy: "alice" });
    const write = await t.call("PUT", `/api/projects/${project}`, { cookie: bob.cookie, body: { design: blankDesign("Shared"), baseRev: 1 } });
    expect(write.status).toBe(200);
  });

  it("shares with a group, and members of it get the access", async () => {
    const g = await t.call("POST", "/api/groups", { cookie: admin, body: { name: "reviewers" } });
    expect(g.status).toBe(201);
    await t.call("PUT", `/api/groups/${g.body.group.id}/members`, { cookie: admin, body: { userIds: [carol.id] } });
    expect((await put(alice.cookie, { group: "reviewers", role: "viewer" })).status).toBe(200);
    expect((await t.call("GET", `/api/projects/${project}`, { cookie: carol.cookie })).status).toBe(200);
  });

  it("only people who may share can see or change the shares", async () => {
    expect((await list(bob.cookie)).status).toBe(403);
    expect((await put(bob.cookie, { user: "carol", role: "viewer" })).status).toBe(403);
    expect((await t.call("GET", `/api/projects/${project}/share-targets`, { cookie: bob.cookie })).status).toBe(403);
    const other = (await t.call("POST", "/api/projects", { cookie: alice.cookie, body: { design: blankDesign("Mine") } })).body.project.id;
    expect((await list(carol.cookie, other)).status).toBe(404);
  });

  it("refuses unknown names, the owner, a disabled user and a body that names both or neither", async () => {
    const code = async (body: object) => (await put(alice.cookie, body)).body.error?.code;
    expect(await code({ user: "nobody", role: "viewer" })).toBe("no_such_user");
    expect(await code({ group: "nobody", role: "viewer" })).toBe("no_such_group");
    expect(await code({ user: "alice", role: "viewer" })).toBe("owner_share");
    expect(await code({ user: "bob", group: "reviewers", role: "viewer" })).toBe("invalid_share");
    expect(await code({ role: "viewer" })).toBe("invalid_share");
    const dave = await addMember(t, admin, "dave");
    await t.call("PATCH", `/api/users/${dave.id}`, { cookie: admin, body: { disabled: true } });
    expect(await code({ user: "dave", role: "viewer" })).toBe("no_such_user");
  });

  it("lists the people and groups that can be picked", async () => {
    const r = await t.call("GET", `/api/projects/${project}/share-targets`, { cookie: alice.cookie });
    expect(r.status).toBe(200);
    expect(r.body.users).toEqual(expect.arrayContaining(["alice", "bob", "carol"]));
    expect(r.body.users).not.toContain("dave");
    expect(r.body.groups).toContain("reviewers");
  });

  it("removes a share, which takes the access away, and audits both changes", async () => {
    const bobShare = (await list(alice.cookie)).body.shares.find((s: any) => s.name === "bob");
    expect((await t.call("DELETE", `/api/projects/${project}/shares/${bobShare.id}`, { cookie: alice.cookie })).status).toBe(200);
    expect((await t.call("GET", `/api/projects/${project}`, { cookie: bob.cookie })).status).toBe(404);
    expect((await t.call("DELETE", `/api/projects/${project}/shares/${bobShare.id}`, { cookie: alice.cookie })).status).toBe(404);
    const actions = (await t.db.selectFrom("audit_log").select("action").execute()).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["project.shared", "project.unshared"]));
  });
});

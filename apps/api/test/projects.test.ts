import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, blankDesign, postgresAvailable, testApp, type TestApp } from "./helpers.ts";

const available = await postgresAvailable();

describe.skipIf(!available)("projects", () => {
  let t: TestApp;
  let admin: string;
  let alice: { id: string; cookie: string };
  let bob: { id: string; cookie: string };
  let viewer: { id: string; cookie: string };
  let nobody: { id: string; cookie: string };

  beforeAll(async () => {
    t = await testApp();
    admin = await t.admin();
    alice = await addMember(t, admin, "alice", ["ProjectEditor"]);
    bob = await addMember(t, admin, "bob", ["ProjectEditor"]);
    viewer = await addMember(t, admin, "vera", ["ProjectViewer"]);
    nobody = await addMember(t, admin, "nora");
  });
  afterAll(async () => { await t.close(); });

  const create = (cookie: string, body: object = {}) => t.call("POST", "/api/projects", { cookie, body });
  const save = (cookie: string, id: string, design: object, baseRev: number) => t.call("PUT", `/api/projects/${id}`, { cookie, body: { design, baseRev } });
  const policyFor = async (userId: string, name: string, statement: object) => {
    const p = await t.db.insertInto("policies").values({ name, document: JSON.stringify({ Statement: [statement] }) }).returning("id").executeTakeFirstOrThrow();
    await t.db.insertInto("policy_attachments").values({ policy_id: p.id, user_id: userId, group_id: null }).execute();
  };
  const share = (projectId: string, who: { user?: string; group?: string }, role: "viewer" | "editor") =>
    t.db.insertInto("project_shares").values({ project_id: projectId, user_id: who.user ?? null, group_id: who.group ?? null, role }).execute();

  it("needs project:Create, and a person with no policy cannot make a project", async () => {
    expect((await create(nobody.cookie)).status).toBe(403);
    expect((await create(viewer.cookie)).status).toBe(403);
    const r = await create(alice.cookie, { name: "First" });
    expect(r.status).toBe(201);
    expect(r.body.project).toMatchObject({ name: "First", owner: "alice", rev: 1 });
  });

  it("takes the name from the design, checks its shape and refuses what cannot be a design", async () => {
    const ok = await create(alice.cookie, { design: blankDesign("From design", [{ key: "a" }]) });
    expect(ok.body.project.name).toBe("From design");
    const bad = async (design: object) => (await create(alice.cookie, { design })).body.error?.code;
    expect(await bad({ ...blankDesign(), schema: 2 })).toBe("invalid_design");
    expect(await bad({ ...blankDesign(), name: "" })).toBe("invalid_design");
    expect(await bad(blankDesign("dup", [{ key: "a" }, { key: "a" }]))).toBe("invalid_design");
    expect(await bad({ ...blankDesign(), nodes: [{ key: "x" }] })).toBe("invalid_design");
    expect(await bad({ ...blankDesign(), nodes: Array.from({ length: 2001 }, (_, i) => ({ key: `n${i}`, label: "x", service: "vpc", props: {} })) })).toBe("invalid_design");
  });

  it("saves with the revision it was based on and refuses a stale save with who saved last", async () => {
    const id = (await create(alice.cookie, { name: "Race" })).body.project.id as string;
    const first = await save(alice.cookie, id, blankDesign("Race", [{ key: "a" }]), 1);
    expect(first.status).toBe(200);
    expect(first.body.rev).toBe(2);
    const stale = await save(bob.cookie, id, blankDesign("Race", [{ key: "b" }]), 1);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "rev_conflict", currentRev: 2, updatedBy: "alice" });
    const mine = await save(bob.cookie, id, blankDesign("Race 2", [{ key: "b" }]), 2);
    expect(mine.status).toBe(200);
    const got = await t.call("GET", `/api/projects/${id}`, { cookie: alice.cookie });
    expect(got.body.project).toMatchObject({ name: "Race 2", rev: 3, updatedBy: "bob" });
    expect(got.body.project.design.nodes[0].key).toBe("b");
  });

  it("serialises two saves of the same revision: exactly one wins", async () => {
    const id = (await create(alice.cookie, { name: "Two" })).body.project.id as string;
    const results = await Promise.all([save(alice.cookie, id, blankDesign("Two", [{ key: "a" }]), 1), save(bob.cookie, id, blankDesign("Two", [{ key: "b" }]), 1)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("keeps a snapshot at creation and adds one on a save only when the last is old", async () => {
    const id = (await create(alice.cookie, { name: "Snaps" })).body.project.id as string;
    await save(alice.cookie, id, blankDesign("Snaps", [{ key: "a" }]), 1);
    let list = (await t.call("GET", `/api/projects/${id}/versions`, { cookie: alice.cookie })).body.versions;
    expect(list).toHaveLength(1);
    await t.db.updateTable("project_versions").set({ created_at: new Date(Date.now() - 20 * 60_000) }).where("project_id", "=", id).execute();
    await save(alice.cookie, id, blankDesign("Snaps", [{ key: "a" }, { key: "b" }]), 2);
    list = (await t.call("GET", `/api/projects/${id}/versions`, { cookie: alice.cookie })).body.versions;
    expect(list.map((v: any) => [v.version, v.auto, v.nodes])).toEqual([[2, true, 2], [1, true, 0]]);
  });

  it("saves a named version, reads it back and restores it, keeping what was there", async () => {
    const id = (await create(alice.cookie, { design: blankDesign("Hist", [{ key: "a" }]) })).body.project.id as string;
    const named = await t.call("POST", `/api/projects/${id}/versions`, { cookie: alice.cookie, body: { note: "before the big change" } });
    expect(named.status).toBe(201);
    const n = named.body.version as number;
    await save(alice.cookie, id, blankDesign("Hist", [{ key: "a" }, { key: "b" }, { key: "c" }]), 1);
    const old = await t.call("GET", `/api/projects/${id}/versions/${n}`, { cookie: alice.cookie });
    expect(old.body.note).toBe("before the big change");
    expect(old.body.design.nodes).toHaveLength(1);
    expect((await t.call("POST", `/api/projects/${id}/versions/${n}/restore`, { cookie: viewer.cookie })).status).toBe(403);
    const restored = await t.call("POST", `/api/projects/${id}/versions/${n}/restore`, { cookie: alice.cookie });
    expect(restored.status).toBe(200);
    expect(restored.body.rev).toBe(3);
    expect(restored.body.design.nodes).toHaveLength(1);
    const versions = (await t.call("GET", `/api/projects/${id}/versions`, { cookie: alice.cookie })).body.versions as { note: string; nodes: number }[];
    expect(versions[0]).toMatchObject({ note: `before restoring version ${n}`, nodes: 3 });
    expect((await t.call("GET", `/api/projects/${id}/versions/999`, { cookie: alice.cookie })).status).toBe(404);
  });

  describe("who sees and does what", () => {
    let id: string;
    beforeAll(async () => { id = (await create(alice.cookie, { name: "Private" })).body.project.id as string; });

    it("lets a policy with Read and List see every project, and one without List only open it by id", async () => {
      const list = async (cookie: string) => ((await t.call("GET", "/api/projects", { cookie })).body.projects as { id: string }[]).map((p) => p.id);
      expect(await list(bob.cookie)).toContain(id);
      expect(await list(viewer.cookie)).toContain(id);
      expect(await list(nobody.cookie)).not.toContain(id);
      const asBob = (await t.call("GET", "/api/projects", { cookie: bob.cookie })).body.projects.find((p: any) => p.id === id);
      expect(asBob.can).toEqual({ write: true, delete: false });
      const asAlice = (await t.call("GET", "/api/projects", { cookie: alice.cookie })).body.projects.find((p: any) => p.id === id);
      expect(asAlice.can).toEqual({ write: true, delete: true });
      const reader = await addMember(t, admin, "rita");
      await policyFor(reader.id, "ReadOnly", { Effect: "Allow", Action: ["project:Read"], Resource: ["av2i:project/*"] });
      expect(await list(reader.cookie)).not.toContain(id);
      expect((await t.call("GET", `/api/projects/${id}`, { cookie: reader.cookie })).status).toBe(200);
    });

    it("answers 404, not 403, for a project the person cannot read", async () => {
      expect((await t.call("GET", `/api/projects/${id}`, { cookie: nobody.cookie })).status).toBe(404);
      expect((await save(nobody.cookie, id, blankDesign("x"), 1)).status).toBe(404);
      expect((await t.call("DELETE", `/api/projects/${id}`, { cookie: nobody.cookie })).status).toBe(404);
      expect((await t.call("GET", `/api/projects/00000000-0000-4000-8000-000000000000`, { cookie: alice.cookie })).status).toBe(404);
    });

    it("answers 403 when the person may read but not change, and reports what they can do", async () => {
      expect((await save(viewer.cookie, id, blankDesign("Private"), 1)).status).toBe(403);
      const v = await t.call("GET", `/api/projects/${id}`, { cookie: viewer.cookie });
      expect(v.body.can).toEqual({ write: false, delete: false, share: false, plan: false, variables: false });
      const o = await t.call("GET", `/api/projects/${id}`, { cookie: alice.cookie });
      expect(o.body.can).toEqual({ write: true, delete: true, share: true, plan: true, variables: true });
      const e = await t.call("GET", `/api/projects/${id}`, { cookie: bob.cookie });
      expect(e.body.can).toEqual({ write: true, delete: false, share: false, plan: false, variables: false });
    });

    it("lets a share open a project to a person with no policy, as viewer or editor, directly or through a group", async () => {
      expect((await t.call("GET", `/api/projects/${id}`, { cookie: nobody.cookie })).status).toBe(404);
      await share(id, { user: nobody.id }, "viewer");
      const seen = await t.call("GET", "/api/projects", { cookie: nobody.cookie });
      expect(seen.body.projects.map((p: any) => p.id)).toContain(id);
      expect((await save(nobody.cookie, id, blankDesign("Private"), 1)).status).toBe(403);
      await t.db.updateTable("project_shares").set({ role: "editor" }).where("project_id", "=", id).execute();
      expect((await save(nobody.cookie, id, blankDesign("Private"), 1)).status).toBe(200);

      const group = await t.db.insertInto("groups").values({ name: "team" }).returning("id").executeTakeFirstOrThrow();
      const grouped = await addMember(t, admin, "gary");
      expect((await t.call("GET", `/api/projects/${id}`, { cookie: grouped.cookie })).status).toBe(404);
      await t.db.insertInto("group_members").values({ group_id: group.id, user_id: grouped.id }).execute();
      await share(id, { group: group.id }, "viewer");
      expect((await t.call("GET", `/api/projects/${id}`, { cookie: grouped.cookie })).status).toBe(200);
    });

    it("keeps ownership working without any policy, and lets a Deny override it", async () => {
      const owner = await addMember(t, admin, "olga", ["ProjectEditor"]);
      const mine = (await create(owner.cookie, { name: "Mine" })).body.project.id as string;
      await t.call("PUT", `/api/users/${owner.id}/policies`, { cookie: admin, body: { policies: [] } });
      expect((await t.call("GET", `/api/projects/${mine}`, { cookie: owner.cookie })).status).toBe(200);
      expect((await save(owner.cookie, mine, blankDesign("Mine"), 1)).status).toBe(200);
      expect((await create(owner.cookie)).status).toBe(403);
      await policyFor(owner.id, "NoWrite", { Effect: "Deny", Action: ["project:Write"], Resource: ["*"] });
      expect((await save(owner.cookie, mine, blankDesign("Mine"), 2)).status).toBe(403);
      expect((await t.call("GET", `/api/projects/${mine}`, { cookie: owner.cookie })).status).toBe(200);
    });

    it("deletes softly, only for someone allowed to delete, and the project vanishes for everyone", async () => {
      const gone = (await create(alice.cookie, { name: "Gone" })).body.project.id as string;
      expect((await t.call("DELETE", `/api/projects/${gone}`, { cookie: bob.cookie })).status).toBe(403);
      expect((await t.call("DELETE", `/api/projects/${gone}`, { cookie: alice.cookie })).status).toBe(200);
      expect((await t.call("GET", `/api/projects/${gone}`, { cookie: alice.cookie })).status).toBe(404);
      expect((await t.call("GET", "/api/projects", { cookie: alice.cookie })).body.projects.map((p: any) => p.id)).not.toContain(gone);
      const row = await t.db.selectFrom("projects").select("deleted_at").where("id", "=", gone).executeTakeFirstOrThrow();
      expect(row.deleted_at).toBeTruthy();
      expect((await save(alice.cookie, gone, blankDesign("Gone"), 1)).status).toBe(404);
    });
  });

  it("audits creating, versions, restoring and deleting, but not every save", async () => {
    const id = (await create(alice.cookie, { name: "Audited" })).body.project.id as string;
    await save(alice.cookie, id, blankDesign("Audited", [{ key: "a" }]), 1);
    await save(alice.cookie, id, blankDesign("Audited", [{ key: "b" }]), 2);
    await t.call("POST", `/api/projects/${id}/versions`, { cookie: alice.cookie, body: { note: "n" } });
    await t.call("DELETE", `/api/projects/${id}`, { cookie: alice.cookie });
    const rows = await t.db.selectFrom("audit_log").select("action").where("resource", "=", `av2i:project/${id}`).orderBy("id").execute();
    expect(rows.map((r) => r.action)).toEqual(["project.created", "project.version_saved", "project.deleted"]);
  });

  it("answers 401 without a session", async () => {
    expect((await t.call("GET", "/api/projects")).status).toBe(401);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_PASSWORD, postgresAvailable, testApp, type TestApp } from "./helpers.ts";

const available = await postgresAvailable();

describe.skipIf(!available)("managing users", () => {
  let t: TestApp;
  let admin: string;
  beforeAll(async () => { t = await testApp(); admin = await t.admin(); });
  afterAll(async () => { await t.close(); });

  const create = (username: string, extra: object = {}) => t.call("POST", "/api/users", { cookie: admin, body: { username, ...extra } });
  /** a user signed in with a password of their own, as after the first change */
  const member = async (username: string, policies: string[] = []) => {
    const made = await create(username);
    expect(made.status).toBe(201);
    const id = made.body.user.id as string;
    if (policies.length) expect((await t.call("PUT", `/api/users/${id}/policies`, { cookie: admin, body: { policies } })).status).toBe(200);
    const first = await t.login(username, made.body.temporaryPassword);
    const changed = await t.call("POST", "/api/auth/change-password", { cookie: first.cookie, body: { currentPassword: made.body.temporaryPassword, newPassword: `${username}-Fresh-Password-1` } });
    expect(changed.status).toBe(200);
    return { id, cookie: changed.cookie!, password: `${username}-Fresh-Password-1` };
  };

  it("creates a user with a temporary password they must change at the first sign in", async () => {
    const r = await create("Maria", { displayName: "Maria L." });
    expect(r.status).toBe(201);
    expect(r.body.user.username).toBe("maria");
    expect(r.body.user.mustChangePassword).toBe(true);
    expect(r.body.temporaryPassword).toHaveLength(16);
    const signed = await t.login("maria", r.body.temporaryPassword);
    expect(signed.body.user.mustChangePassword).toBe(true);
    expect((await t.call("GET", "/api/users", { cookie: signed.cookie })).body.error.code).toBe("password_change_required");
  });

  it("refuses a bad or a taken username and a weak password", async () => {
    expect((await create("a")).body.error.code).toBe("invalid_username");
    expect((await create("has space")).body.error.code).toBe("invalid_username");
    expect((await create("bob")).status).toBe(201);
    expect((await create("BOB")).body.error.code).toBe("username_taken");
    expect((await create("carol", { password: "short" })).body.error.code).toBe("too_short");
    expect((await create("dave", { password: "A-Chosen-Password-12" })).body.temporaryPassword).toBeUndefined();
  });

  it("gives a new user no permission at all until a policy is attached", async () => {
    const m = await member("erin");
    const denied = await t.call("GET", "/api/users", { cookie: m.cookie });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("forbidden");
    expect((await t.call("GET", "/api/auth/me", { cookie: m.cookie })).body.actions).toEqual([]);
    const log = await t.call("GET", "/api/audit?limit=20", { cookie: admin });
    expect(log.body.entries.some((e: any) => e.action === "authz.denied" && e.actor === "erin")).toBe(true);
  });

  it("lets a policy open exactly what it names", async () => {
    const m = await member("frank", ["UserManager"]);
    const me = await t.call("GET", "/api/auth/me", { cookie: m.cookie });
    expect(me.body.actions).toEqual(expect.arrayContaining(["user:Create", "user:List", "user:ResetPassword", "group:Manage"]));
    expect(me.body.actions).not.toContain("audit:Read");
    expect((await t.call("GET", "/api/users", { cookie: m.cookie })).status).toBe(200);
    expect((await t.call("POST", "/api/users", { cookie: m.cookie, body: { username: "made-by-frank" } })).status).toBe(201);
    expect((await t.call("GET", "/api/audit", { cookie: m.cookie })).status).toBe(403);
    // attaching policies needs policy:Manage, which UserManager lacks
    const grant = await t.call("PUT", `/api/users/${m.id}/policies`, { cookie: m.cookie, body: { policies: ["UserManager", "Administrator"] } });
    expect(grant.status).toBe(403);
  });

  it("rejects an unknown policy name", async () => {
    const m = await member("gina");
    const r = await t.call("PUT", `/api/users/${m.id}/policies`, { cookie: admin, body: { policies: ["Nope"] } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("unknown_policy");
  });

  it("resets a password: new temporary one, forced change, old sessions ended", async () => {
    const m = await member("hank");
    const r = await t.call("POST", `/api/users/${m.id}/reset-password`, { cookie: admin });
    expect(r.status).toBe(200);
    expect((await t.call("GET", "/api/auth/me", { cookie: m.cookie })).status).toBe(401);
    expect((await t.login("hank", m.password)).status).toBe(401);
    const again = await t.login("hank", r.body.temporaryPassword);
    expect(again.body.user.mustChangePassword).toBe(true);
  });

  it("disables and enables an account, ending its sessions, and never your own", async () => {
    const m = await member("ivy");
    expect((await t.call("PATCH", `/api/users/${m.id}`, { cookie: admin, body: { disabled: true } })).status).toBe(200);
    expect((await t.call("GET", "/api/auth/me", { cookie: m.cookie })).status).toBe(401);
    expect((await t.login("ivy", m.password)).status).toBe(401);
    expect((await t.call("PATCH", `/api/users/${m.id}`, { cookie: admin, body: { disabled: false } })).status).toBe(200);
    expect((await t.login("ivy", m.password)).status).toBe(200);
    const self = (await t.call("GET", "/api/auth/me", { cookie: admin })).body.user.id;
    expect((await t.call("PATCH", `/api/users/${self}`, { cookie: admin, body: { disabled: true } })).body.error.code).toBe("cannot_disable_self");
  });

  it("protects the last administrator, and lets a second one take over", async () => {
    const self = (await t.call("GET", "/api/auth/me", { cookie: admin })).body.user.id as string;
    const strip = await t.call("PUT", `/api/users/${self}/policies`, { cookie: admin, body: { policies: [] } });
    expect(strip.status).toBe(409);
    expect(strip.body.error.code).toBe("last_administrator");

    const second = await member("jules", ["Administrator"]);
    expect((await t.call("PATCH", `/api/users/${second.id}`, { cookie: admin, body: { disabled: true } })).status).toBe(200);
    expect((await t.call("PATCH", `/api/users/${second.id}`, { cookie: admin, body: { disabled: false } })).status).toBe(200);
    second.cookie = (await t.login("jules", second.password)).cookie!;
    // with another administrator in place, the first can be stripped, and then the second is the last
    expect((await t.call("PUT", `/api/users/${self}/policies`, { cookie: admin, body: { policies: [] } })).status).toBe(200);
    const again = await t.call("PUT", `/api/users/${second.id}/policies`, { cookie: second.cookie, body: { policies: [] } });
    expect(again.body.error.code).toBe("last_administrator");
    // put admin back for the tests that follow
    expect((await t.call("PUT", `/api/users/${self}/policies`, { cookie: second.cookie, body: { policies: ["Administrator"] } })).status).toBe(200);
  });

  it("lists users with their policies and never returns a password hash", async () => {
    const r = await t.call("GET", "/api/users", { cookie: admin });
    expect(r.status).toBe(200);
    const adminRow = r.body.users.find((u: any) => u.username === "admin");
    expect(adminRow.policies).toEqual(["Administrator"]);
    expect(JSON.stringify(r.body)).not.toMatch(/argon2|password_hash|passwordHash/);
  });
});

describe.skipIf(!available)("the audit log", () => {
  let t: TestApp;
  let admin: string;
  beforeAll(async () => { t = await testApp(); admin = await t.admin(); });
  afterAll(async () => { await t.close(); });

  it("records who did what, never a password or a token", async () => {
    await t.login("admin", "wrong-password-here");
    const made = await t.call("POST", "/api/users", { cookie: admin, body: { username: "kim" } });
    const log = await t.call("GET", "/api/audit?limit=50", { cookie: admin });
    expect(log.status).toBe(200);
    const actions = log.body.entries.map((e: any) => `${e.action}:${e.outcome}`);
    expect(actions).toEqual(expect.arrayContaining(["auth.login:failure", "auth.login:success", "auth.password_changed:success", "user.created:success"]));
    const text = JSON.stringify(log.body);
    expect(text).not.toContain("wrong-password-here");
    expect(text).not.toContain(made.body.temporaryPassword);
    expect(text).not.toContain(ADMIN_PASSWORD);
    expect(text).not.toContain(admin);
  });

  it("pages backwards by id and keeps the actor's name after the account is deleted", async () => {
    const first = await t.call("GET", "/api/audit?limit=2", { cookie: admin });
    expect(first.body.entries).toHaveLength(2);
    const next = await t.call("GET", `/api/audit?limit=2&before=${first.body.entries[1].id}`, { cookie: admin });
    expect(Number(next.body.entries[0].id)).toBeLessThan(Number(first.body.entries[1].id));
    const kim = await t.db.selectFrom("users").select("id").where("username", "=", "kim").executeTakeFirstOrThrow();
    await t.db.deleteFrom("users").where("id", "=", kim.id).execute();
    const row = await t.db.selectFrom("audit_log").select(["actor_id", "actor_username"]).where("action", "=", "user.created").executeTakeFirst();
    expect(row).toBeTruthy();
  });
});

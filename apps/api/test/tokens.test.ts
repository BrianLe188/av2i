import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, blankDesign, postgresAvailable, testApp, type TestApp } from "./helpers.ts";

const available = await postgresAvailable();

describe.skipIf(!available)("api tokens", () => {
  let t: TestApp;
  let admin: string;
  let alice: { id: string; cookie: string; password: string };
  let bob: { id: string; cookie: string };
  let nobody: { id: string; cookie: string };

  beforeAll(async () => {
    t = await testApp();
    admin = await t.admin();
    alice = await addMember(t, admin, "alice", ["ProjectEditor"]);
    bob = await addMember(t, admin, "bob", ["ProjectEditor"]);
    nobody = await addMember(t, admin, "nora");
  });
  afterAll(async () => { await t.close(); });

  const make = async (cookie: string, body: object = { name: "ci" }) => {
    const r = await t.call("POST", "/api/tokens", { cookie, body });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return { id: r.body.token.id as string, secret: r.body.secret as string };
  };
  /** a call that carries only the bearer secret: no cookie, no CSRF header */
  const bearer = (secret: string, method: string, url: string, body?: unknown) =>
    t.call(method, url, { csrf: false, headers: { authorization: `Bearer ${secret}` }, ...(body !== undefined ? { body } : {}) });

  it("shows the secret once, keeps only its hash, and never lists it again", async () => {
    const r = await t.call("POST", "/api/tokens", { cookie: alice.cookie, body: { name: "laptop", expiresInDays: 30 } });
    expect(r.status).toBe(201);
    expect(r.body.secret).toMatch(/^av2i_[A-Za-z0-9_-]{43}$/);
    expect(r.body.token).toMatchObject({ name: "laptop", status: "active", actions: null, prefix: r.body.secret.slice(0, 11) });
    const row = await t.db.selectFrom("api_tokens").selectAll().where("id", "=", r.body.token.id).executeTakeFirstOrThrow();
    expect(row.token_hash.equals(createHash("sha256").update(r.body.secret).digest())).toBe(true);
    expect(JSON.stringify(row)).not.toContain(r.body.secret);
    const list = await t.call("GET", "/api/tokens", { cookie: alice.cookie });
    expect(JSON.stringify(list.body)).not.toContain(r.body.secret);
    expect(list.body.tokens.find((x: any) => x.id === r.body.token.id)).toMatchObject({ name: "laptop", status: "active" });
  });

  it("acts as the person with a bearer secret alone, and notes the use", async () => {
    const { id, secret } = await make(alice.cookie);
    const created = await bearer(secret, "POST", "/api/projects", { design: blankDesign("Made by CI") });
    expect(created.status).toBe(201);
    expect(created.body.project.owner).toBe("alice");
    const list = await bearer(secret, "GET", "/api/projects");
    expect(list.body.projects.map((p: any) => p.name)).toContain("Made by CI");
    const row = await t.db.selectFrom("api_tokens").select(["last_used_at", "last_used_ip"]).where("id", "=", id).executeTakeFirstOrThrow();
    expect(row.last_used_at).not.toBeNull();
    expect(row.last_used_ip).toBeTruthy();
  });

  it("never gives more than the person has, however the token was made", async () => {
    const { secret } = await make(nobody.cookie);
    expect((await bearer(secret, "POST", "/api/projects", { name: "x" })).status).toBe(403);
    expect((await bearer(secret, "GET", "/api/users")).status).toBe(403);
  });

  it("limits a scoped token to its actions, owner and shares included", async () => {
    const made = await make(alice.cookie, { name: "read only", actions: ["project:Read", "project:List"] });
    const project = (await t.call("POST", "/api/projects", { cookie: alice.cookie, body: { design: blankDesign("Scoped") } })).body.project.id;
    expect((await bearer(made.secret, "GET", `/api/projects/${project}`)).status).toBe(200);
    const read = await bearer(made.secret, "GET", `/api/projects/${project}`);
    expect(read.body.can).toMatchObject({ write: false, delete: false });
    expect((await bearer(made.secret, "PUT", `/api/projects/${project}`, { design: blankDesign("Scoped"), baseRev: 1 })).status).toBe(403);
    expect((await bearer(made.secret, "DELETE", `/api/projects/${project}`)).status).toBe(403);
    expect((await bearer(made.secret, "POST", "/api/projects", { name: "no" })).status).toBe(403);
    expect((await bearer(made.secret, "GET", "/api/projects")).body.projects.map((p: any) => p.id)).toContain(project);
    const me = await bearer(made.secret, "GET", "/api/auth/me");
    expect(me.body.actions).toEqual(expect.arrayContaining(["project:Read"]));
    expect(me.body.actions).not.toContain("project:Write");
  });

  it("cannot manage tokens, the password or the session", async () => {
    const { secret } = await make(alice.cookie);
    const code = async (r: Promise<{ status: number; body: any }>) => { const x = await r; return [x.status, x.body.error?.code]; };
    expect(await code(bearer(secret, "POST", "/api/tokens", { name: "more" }))).toEqual([403, "session_required"]);
    expect(await code(bearer(secret, "GET", "/api/tokens"))).toEqual([403, "session_required"]);
    expect(await code(bearer(secret, "POST", "/api/auth/change-password", { currentPassword: "x", newPassword: "y" }))).toEqual([403, "session_required"]);
    expect(await code(bearer(secret, "POST", "/api/auth/logout"))).toEqual([403, "session_required"]);
    expect((await bearer(secret, "GET", "/api/auth/me")).status).toBe(200);
  });

  it("answers 401 for an unknown secret, and a good cookie beside a bad secret is not a way in", async () => {
    const wrong = await bearer("av2i_" + "A".repeat(43), "GET", "/api/projects");
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("invalid_token");
    expect((await bearer("not-a-token", "GET", "/api/projects")).status).toBe(401);
    const both = await t.call("GET", "/api/projects", { cookie: alice.cookie, csrf: false, headers: { authorization: "Bearer av2i_" + "B".repeat(43) } });
    expect(both.status).toBe(401);
  });

  it("still asks for the CSRF header on a cookie call, and only a bearer call skips it", async () => {
    const cookieOnly = await t.call("POST", "/api/projects", { cookie: alice.cookie, csrf: false, body: { name: "x" } });
    expect(cookieOnly.status).toBe(403);
    expect(cookieOnly.body.error.code).toBe("csrf");
  });

  it("stops working when revoked, and only its owner can revoke it", async () => {
    const { id, secret } = await make(alice.cookie);
    expect((await bearer(secret, "GET", "/api/projects")).status).toBe(200);
    expect((await t.call("DELETE", `/api/tokens/${id}`, { cookie: bob.cookie })).status).toBe(404);
    expect((await t.call("DELETE", `/api/tokens/${id}`, { cookie: alice.cookie })).status).toBe(200);
    expect((await bearer(secret, "GET", "/api/projects")).status).toBe(401);
    expect((await t.call("DELETE", `/api/tokens/${id}`, { cookie: alice.cookie })).status).toBe(404);
    const listed = (await t.call("GET", "/api/tokens", { cookie: alice.cookie })).body.tokens.find((x: any) => x.id === id);
    expect(listed.status).toBe("revoked");
  });

  it("stops working at its expiry", async () => {
    const { id, secret } = await make(alice.cookie, { name: "short", expiresInDays: 1 });
    expect((await bearer(secret, "GET", "/api/projects")).status).toBe(200);
    await t.db.updateTable("api_tokens").set({ expires_at: new Date(Date.now() - 1000) }).where("id", "=", id).execute();
    expect((await bearer(secret, "GET", "/api/projects")).status).toBe(401);
    expect((await t.call("GET", "/api/tokens", { cookie: alice.cookie })).body.tokens.find((x: any) => x.id === id).status).toBe("expired");
  });

  it("stops working when the account is disabled, and comes back with it", async () => {
    const carol = await addMember(t, admin, "carol", ["ProjectEditor"]);
    const { secret } = await make(carol.cookie);
    expect((await bearer(secret, "GET", "/api/projects")).status).toBe(200);
    await t.call("PATCH", `/api/users/${carol.id}`, { cookie: admin, body: { disabled: true } });
    expect((await bearer(secret, "GET", "/api/projects")).status).toBe(401);
    await t.call("PATCH", `/api/users/${carol.id}`, { cookie: admin, body: { disabled: false } });
    expect((await bearer(secret, "GET", "/api/projects")).status).toBe(200);
  });

  it("is refused while the password still has to be changed", async () => {
    const made = await t.call("POST", "/api/users", { cookie: admin, body: { username: "newbie" } });
    const { secret, prefix } = { secret: "av2i_" + "C".repeat(43), prefix: "av2i_CCCCCC" };
    await t.db.insertInto("api_tokens").values({ user_id: made.body.user.id, name: "early", token_hash: createHash("sha256").update(secret).digest(), prefix, actions: null }).execute();
    const r = await bearer(secret, "GET", "/api/projects");
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("password_change_required");
  });

  it("checks the name, the scope and the expiry, and caps the active tokens", async () => {
    const code = async (body: object) => (await t.call("POST", "/api/tokens", { cookie: bob.cookie, body })).body.error?.code;
    expect(await code({ name: "   " })).toBe("invalid_token_name");
    expect(await code({ name: "x", actions: ["project:Fly"] })).toBe("invalid_scope");
    expect(await code({ name: "x", actions: [] })).toBe("invalid_scope");
    expect(await code({ name: "x", expiresInDays: 0 })).toBe("invalid_request");
    expect(await code({ name: "x", expiresInDays: 9999 })).toBe("invalid_request");
    for (let i = 0; i < 20; i++) await make(bob.cookie, { name: `t${i}` });
    expect(await code({ name: "one too many" })).toBe("too_many_tokens");
  });

  it("audits creating and revoking without writing the secret", async () => {
    const { id, secret } = await make(alice.cookie, { name: "audited" });
    await t.call("DELETE", `/api/tokens/${id}`, { cookie: alice.cookie });
    const rows = await t.db.selectFrom("audit_log").selectAll().where("action", "in", ["token.created", "token.revoked"]).execute();
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["token.created", "token.revoked"]));
    expect(JSON.stringify(rows)).not.toContain(secret);
  });
});

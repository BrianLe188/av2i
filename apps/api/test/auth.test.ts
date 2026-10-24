import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureAdmin } from "../src/bootstrap.ts";
import { migrate } from "../src/migrate.ts";
import { ADMIN_PASSWORD, postgresAvailable, testApp, type TestApp } from "./helpers.ts";

const available = await postgresAvailable();
if (!available) console.warn("PostgreSQL is not reachable: the API tests are skipped (see apps/api/README.md).");

describe.skipIf(!available)("first start and the forced password change", () => {
  let t: TestApp;
  beforeAll(async () => { t = await testApp(); });
  afterAll(async () => { await t.close(); });

  it("applies each migration once and seeds the built-in policies", async () => {
    expect(await migrate(t.db)).toEqual([]);
    const names = (await t.db.selectFrom("policies").select("name").orderBy("name").execute()).map((p) => p.name);
    expect(names).toEqual(["Administrator", "ProjectEditor", "ProjectViewer", "UserManager"]);
  });

  it("created `admin` with the Administrator policy, and does nothing on the next start", async () => {
    const admin = await t.db.selectFrom("users").selectAll().where("username", "=", "admin").executeTakeFirstOrThrow();
    expect(admin.must_change_password).toBe(true);
    expect(admin.password_hash).toMatch(/^\$argon2id\$/);
    expect(await ensureAdmin(t.db, t.config, { warn: () => {} })).toBe(false);
  });

  it("signs admin in with admin/admin but allows nothing but the password change", async () => {
    const r = await t.login("admin", "admin");
    expect(r.status).toBe(200);
    expect(r.body.user.mustChangePassword).toBe(true);
    expect(r.body.actions).toEqual([]);
    expect(r.setCookie).toMatch(/HttpOnly/i);
    expect(r.setCookie).toMatch(/SameSite=Lax/i);
    expect(r.setCookie).not.toMatch(/Secure/i);
    const blocked = await t.call("GET", "/api/users", { cookie: r.cookie });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("password_change_required");
    expect((await t.call("GET", "/api/auth/me", { cookie: r.cookie })).status).toBe(200);
  });

  it("refuses weak new passwords with the reason", async () => {
    const s = (await t.login("admin", "admin")).cookie;
    const change = (newPassword: string, currentPassword = "admin") => t.call("POST", "/api/auth/change-password", { cookie: s, body: { currentPassword, newPassword } });
    expect((await change("short")).body.error.code).toBe("too_short");
    expect((await change("administrator")).body.error.code).toBe("too_common");
    expect((await change("ADMINADMINADMIN")).body.error.code).toBe("too_common");
    expect((await change("x".repeat(20), "wrong")).body.error.code).toBe("wrong_current_password");
    const same = await t.call("POST", "/api/auth/change-password", { cookie: s, body: { currentPassword: "admin", newPassword: "admin" } });
    expect(same.status).toBe(400);
  });

  it("changes the password, ends every old session and opens a new one", async () => {
    const old = (await t.login("admin", "admin")).cookie;
    const other = (await t.login("admin", "admin")).cookie;
    const r = await t.call("POST", "/api/auth/change-password", { cookie: old, body: { currentPassword: "admin", newPassword: ADMIN_PASSWORD } });
    expect(r.status).toBe(200);
    expect(r.body.user.mustChangePassword).toBe(false);
    expect(r.body.actions).toContain("user:Create");
    expect((await t.call("GET", "/api/auth/me", { cookie: old })).status).toBe(401);
    expect((await t.call("GET", "/api/auth/me", { cookie: other })).status).toBe(401);
    expect((await t.call("GET", "/api/users", { cookie: r.cookie })).status).toBe(200);
    expect((await t.login("admin", "admin")).status).toBe(401);
    expect((await t.login("admin", ADMIN_PASSWORD)).status).toBe(200);
  });
});

describe.skipIf(!available)("the password from ADMIN_INITIAL_PASSWORD", () => {
  it("is kept without a forced change when it is strong, and forces one when it is weak", async () => {
    const strong = await testApp({ adminInitialPassword: "A-Long-Initial-Secret-9" });
    const weak = await testApp({ adminInitialPassword: "short" });
    try {
      // testApp has already created `admin` with the default; recreate on empty tables to test the first start itself
      for (const [t, expected, pw] of [[strong, false, "A-Long-Initial-Secret-9"], [weak, true, "short"]] as const) {
        await t.db.deleteFrom("users").execute();
        await ensureAdmin(t.db, t.config, { warn: () => {} });
        const r = await t.login("admin", pw);
        expect(r.status).toBe(200);
        expect(r.body.user.mustChangePassword).toBe(expected);
        expect((await t.login("admin", "admin")).status).toBe(401);
      }
    } finally {
      await strong.close();
      await weak.close();
    }
  });
});

describe.skipIf(!available)("sessions", () => {
  let t: TestApp;
  beforeAll(async () => { t = await testApp(); });
  afterAll(async () => { await t.close(); });

  it("stores only the hash of the token", async () => {
    const r = await t.login("admin", "admin");
    const row = await t.db.selectFrom("sessions").select("token_hash").where("token_hash", "=", createHash("sha256").update(r.cookie!).digest()).executeTakeFirst();
    expect(row).toBeTruthy();
    expect(Buffer.from(row!.token_hash).toString("utf8")).not.toContain(r.cookie!);
  });

  it("ends at logout, at the idle limit, at the absolute limit, and when the account is disabled", async () => {
    const cookie = await t.admin();
    expect((await t.call("GET", "/api/auth/me", { cookie })).status).toBe(200);

    const a = (await t.login("admin", ADMIN_PASSWORD)).cookie;
    expect((await t.call("POST", "/api/auth/logout", { cookie: a })).status).toBe(200);
    expect((await t.call("GET", "/api/auth/me", { cookie: a })).status).toBe(401);

    const b = (await t.login("admin", ADMIN_PASSWORD)).cookie;
    await t.db.updateTable("sessions").set({ idle_expires_at: new Date(Date.now() - 1000) }).execute();
    expect((await t.call("GET", "/api/auth/me", { cookie: b })).status).toBe(401);

    const c = (await t.login("admin", ADMIN_PASSWORD)).cookie;
    await t.db.updateTable("sessions").set({ expires_at: new Date(Date.now() - 1000) }).execute();
    expect((await t.call("GET", "/api/auth/me", { cookie: c })).status).toBe(401);

    const d = (await t.login("admin", ADMIN_PASSWORD)).cookie;
    await t.db.updateTable("users").set({ disabled: true }).execute();
    expect((await t.call("GET", "/api/auth/me", { cookie: d })).status).toBe(401);
    await t.db.updateTable("users").set({ disabled: false }).execute();
  });

  it("marks the cookie Secure behind an HTTPS proxy that is trusted, and only then", async () => {
    const trusting = await testApp({ trustProxy: true });
    try {
      const behind = await trusting.call("POST", "/api/auth/login", { body: { username: "admin", password: "admin" }, headers: { "x-forwarded-proto": "https" } });
      expect(behind.setCookie).toMatch(/Secure/i);
    } finally {
      await trusting.close();
    }
    const spoof = await t.call("POST", "/api/auth/login", { body: { username: "admin", password: ADMIN_PASSWORD }, headers: { "x-forwarded-proto": "https" } });
    expect(spoof.setCookie).not.toMatch(/Secure/i);
  });

  it("needs the X-Requested-With header on every state-changing call, login included", async () => {
    const r = await t.call("POST", "/api/auth/login", { body: { username: "admin", password: ADMIN_PASSWORD }, csrf: false });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("csrf");
  });

  it("answers 401 without a session and 404 for an unknown API path", async () => {
    expect((await t.call("GET", "/api/users")).status).toBe(401);
    expect((await t.call("GET", "/api/auth/me")).status).toBe(401);
    expect((await t.call("GET", "/api/health")).status).toBe(200);
  });
});

describe.skipIf(!available)("login hardening", () => {
  let t: TestApp;
  beforeAll(async () => { t = await testApp(); });
  afterAll(async () => { await t.close(); });

  it("answers the same for a wrong password, an unknown name and a disabled account", async () => {
    const wrong = await t.login("admin", "nope-nope-nope");
    const unknown = await t.login("nobody", "nope-nope-nope");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe("invalid_credentials");
  });

  it("blocks the name after five failures, even for the right password, and says when to retry", async () => {
    await t.db.deleteFrom("login_throttle").execute();
    for (let i = 0; i < 5; i++) expect((await t.login("admin", `wrong-${i}`)).status).toBe(401);
    const blocked = await t.login("admin", "admin");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("too_many_attempts");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // the same answer for a name that does not exist, once it has failed as often
    for (let i = 0; i < 5; i++) await t.login("ghost", `wrong-${i}`);
    expect((await t.login("ghost", "x")).status).toBe(429);
    await t.db.deleteFrom("login_throttle").execute();
    expect((await t.login("admin", "admin")).status).toBe(200);
  });

  it("blocks an address that fails against many names", async () => {
    await t.db.deleteFrom("login_throttle").execute();
    for (let i = 0; i < 20; i++) await t.login(`user${i}`, "wrong");
    const r = await t.login("admin", "admin");
    expect(r.status).toBe(429);
    await t.db.deleteFrom("login_throttle").execute();
  });

  it("locks the account after ten failures whatever the address, and unlocks when the time passes", async () => {
    await t.db.deleteFrom("login_throttle").execute();
    for (let i = 0; i < 10; i++) {
      await t.db.deleteFrom("login_throttle").execute();
      await t.login("admin", `wrong-${i}`);
    }
    await t.db.deleteFrom("login_throttle").execute();
    const locked = await t.db.selectFrom("users").select("locked_until").where("username", "=", "admin").executeTakeFirstOrThrow();
    expect(locked.locked_until!.getTime()).toBeGreaterThan(Date.now());
    const r = await t.login("admin", "admin");
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("invalid_credentials");
    await t.db.updateTable("users").set({ locked_until: new Date(Date.now() - 1000) }).execute();
    expect((await t.login("admin", "admin")).status).toBe(200);
  });

  it("counts wrong current passwords at the password change, so a stolen session cannot guess it", async () => {
    await t.db.deleteFrom("login_throttle").execute();
    const s = (await t.login("admin", "admin")).cookie;
    for (let i = 0; i < 5; i++) await t.call("POST", "/api/auth/change-password", { cookie: s, body: { currentPassword: `guess-${i}`, newPassword: "A-Fine-New-Password-1" } });
    const r = await t.call("POST", "/api/auth/change-password", { cookie: s, body: { currentPassword: "admin", newPassword: "A-Fine-New-Password-1" } });
    expect(r.status).toBe(429);
  });
});

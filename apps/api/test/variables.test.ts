import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { variablesOf } from "@av2i/generator";
import { addMember, postgresAvailable, testApp, type TestApp } from "./helpers.ts";
import { claim } from "../src/runs/queue.ts";
import { execute } from "../src/runs/runner.ts";

const available = await postgresAvailable();
const base = JSON.parse(readFileSync(join(import.meta.dirname, "../../../packages/testkit/designs/container-backend.json"), "utf8"));
/** The sample design with a password supplied by the user instead of one managed by RDS. */
const withPassword = (() => {
  const d = structuredClone(base);
  const db = d.nodes.find((n: { service: string }) => n.service === "rds");
  db.props = { ...db.props, password: "set-in-the-studio", manage_master_user_password: false };
  return d;
})();
const SECRET = "Sup3r-secret-value";

describe("what a design asks for", () => {
  it("lists the database password as a sensitive variable, and nothing for a managed one", () => {
    expect(variablesOf(withPassword)).toEqual([{ name: "db_password", sensitive: true, node: "db" }]);
    expect(variablesOf(base)).toEqual([]);
  });
});

describe.skipIf(!available)("project variables", () => {
  let t: TestApp;
  let admin: string;
  let alice: { id: string; cookie: string };
  let editor: { id: string; cookie: string };
  let projectId: string;
  const url = (n = "") => `/api/projects/${projectId}/variables${n ? `/${n}` : ""}`;
  const plan = (cookie: string) => t.call("POST", `/api/projects/${projectId}/runs`, { cookie, body: { kind: "plan" } });

  beforeAll(async () => {
    t = await testApp({ tofuBin: join(import.meta.dirname, "fake-tofu.sh"), runWithServerIdentity: true });
    admin = await t.admin();
    alice = await addMember(t, admin, "alice", ["ProjectEditor"]);
    editor = await addMember(t, admin, "erin", ["ProjectEditor"]);
    projectId = (await t.call("POST", "/api/projects", { cookie: alice.cookie, body: { design: withPassword } })).body.project.id;
    await t.db.insertInto("project_shares").values({ project_id: projectId, user_id: editor.id, group_id: null, role: "editor" }).execute();
  });
  afterAll(async () => { await t.close(); });

  it("refuses a plan until the value is set, and says which variable", async () => {
    const r = await plan(alice.cookie);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: "variables_missing", variables: ["db_password"] });
    const list = await t.call("GET", url(), { cookie: alice.cookie });
    expect(list.body.variables).toEqual([{ name: "db_password", sensitive: true, node: "db", set: false, updatedAt: null, updatedBy: null }]);
  });

  it("lets only someone with variable:Write set it, and only for a name the design asks for", async () => {
    expect((await t.call("PUT", url("db_password"), { cookie: editor.cookie, body: { value: SECRET } })).status).toBe(403);
    expect((await t.call("PUT", url("other"), { cookie: alice.cookie, body: { value: SECRET } })).body.error.code).toBe("unknown_variable");
    expect((await t.call("PUT", url("db_password"), { cookie: alice.cookie, body: { value: "" } })).status).toBe(400);
    expect((await t.call("PUT", url("db_password"), { cookie: alice.cookie, body: { value: SECRET } })).status).toBe(200);
  });

  it("never returns the value, keeps it encrypted, and audits the name only", async () => {
    const list = await t.call("GET", url(), { cookie: editor.cookie });
    expect(JSON.stringify(list.body)).not.toContain(SECRET);
    expect(list.body.variables[0]).toMatchObject({ set: true, updatedBy: "alice" });
    const row = await t.db.selectFrom("project_variables").selectAll().where("project_id", "=", projectId).executeTakeFirstOrThrow();
    expect(row.data.includes(Buffer.from(SECRET))).toBe(false);
    const log = await t.db.selectFrom("audit_log").select("details").where("action", "=", "variable.set").execute();
    expect(JSON.stringify(log)).not.toContain(SECRET);
    expect(JSON.stringify(log)).toContain("db_password");
  });

  it("gives the value to tofu as TF_VAR and keeps it out of the log", async () => {
    const r = await plan(alice.cookie);
    expect(r.status).toBe(201);
    const c = await claim(t.db);
    await execute(t.db, t.config, c!);
    const logs = await t.call("GET", `/api/runs/${r.body.run.id}/logs`, { cookie: alice.cookie });
    const text = logs.body.lines.map((l: { line: string }) => l.line).join("\n");
    expect(text).toContain("TF_VAR_db_password=****");
    expect(text).not.toContain(SECRET);
    expect((await t.call("GET", `/api/runs/${r.body.run.id}`, { cookie: alice.cookie })).body.run.status).toBe("succeeded");
  });

  it("stamps the run with the variables, so a changed value is noticed, and removing the value blocks plans again", async () => {
    const stamp = async (id: string) => (await t.db.selectFrom("runs").select("variables_hash").where("id", "=", id).executeTakeFirstOrThrow()).variables_hash;
    const first = await plan(alice.cookie);
    await new Promise((r) => setTimeout(r, 15));
    await t.call("PUT", url("db_password"), { cookie: alice.cookie, body: { value: `${SECRET}-2` } });
    const second = await plan(alice.cookie);
    expect(await stamp(first.body.run.id)).toMatch(/^[0-9a-f]{64}$/);
    expect(await stamp(first.body.run.id)).not.toBe(await stamp(second.body.run.id));
    expect((await t.call("DELETE", url("db_password"), { cookie: editor.cookie })).status).toBe(403);
    expect((await t.call("DELETE", url("db_password"), { cookie: alice.cookie })).status).toBe(200);
    expect((await t.call("DELETE", url("db_password"), { cookie: alice.cookie })).status).toBe(404);
    expect((await plan(alice.cookie)).body.error.code).toBe("variables_missing");
  });

  it("asks nothing for a design with no variables", async () => {
    const id = (await t.call("POST", "/api/projects", { cookie: alice.cookie, body: { design: base } })).body.project.id;
    expect((await t.call("GET", `/api/projects/${id}/variables`, { cookie: alice.cookie })).body.variables).toEqual([]);
    expect((await t.call("PUT", `/api/projects/${id}/variables/db_password`, { cookie: alice.cookie, body: { value: SECRET } })).body.error.code).toBe("unknown_variable");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, memberOf, postgresAvailable, testApp, blankDesign, type TestApp } from "./helpers.ts";
import { seal } from "../src/runs/crypto.ts";
import { addressOf, diffStates, instancesOf, listOutputs, listResources, redactedAttributes, summarizeState } from "../src/runs/stateview.ts";

const PROVIDER = 'provider["registry.opentofu.org/hashicorp/aws"]';
const state = (serial: number, extra: object[] = [], dbPassword = "hunter2") => ({
  version: 4, serial, lineage: "abc",
  outputs: { ip: { value: "1.2.3.4", type: "string" }, db_url: { value: "postgres://u:p@h/d", type: "string", sensitive: true } },
  resources: [
    { mode: "managed", type: "aws_vpc", name: "main", provider: PROVIDER, instances: [{ attributes: { id: "vpc-1", cidr_block: "10.0.0.0/16", tags: { Name: "x" } } }] },
    { mode: "managed", type: "aws_db_instance", name: "db", provider: PROVIDER, instances: [{ attributes: { id: "db-1", identifier: "db", password: dbPassword, nested: { api_key: "k-123", port: 5432 } }, sensitive_attributes: [[{ type: "get_attr", value: "identifier" }]] }] },
    { mode: "managed", type: "aws_subnet", name: "sn", provider: PROVIDER, instances: [{ index_key: 0, attributes: { id: "subnet-0" } }, { index_key: "b", attributes: { id: "subnet-b" } }] },
    { module: "module.net", mode: "data", type: "aws_caller_identity", name: "me", provider: PROVIDER, instances: [{ attributes: { id: "123", account_id: "123" } }] },
    ...extra,
  ],
});

describe("reading a state", () => {
  it("counts instances and outputs, and names resources the way OpenTofu does", () => {
    expect(summarizeState(state(1), 999)).toEqual({ resources: 5, outputs: 2, bytes: 999 });
    expect(listResources(state(1)).map((r) => r.address)).toEqual(["aws_vpc.main", "aws_db_instance.db", "aws_subnet.sn[0]", 'aws_subnet.sn["b"]', "module.net.data.aws_caller_identity.me"]);
    expect(addressOf({ type: "t", name: "n" })).toBe("t.n");
    expect(listResources(state(1))[0]).toMatchObject({ type: "aws_vpc", provider: "hashicorp/aws", id: "vpc-1", module: null });
  });

  it("hides what the state marks sensitive, secrets by name at any depth, and the value of a sensitive output", () => {
    const [db] = instancesOf(state(1), "aws_db_instance.db");
    expect(db!.attributes).toMatchObject({ id: "db-1", identifier: "(sensitive)", password: "(sensitive)", nested: { api_key: "(sensitive)", port: 5432 } });
    expect(JSON.stringify(db)).not.toContain("hunter2");
    expect(listOutputs(state(1))).toEqual([{ name: "ip", sensitive: false, value: "1.2.3.4" }, { name: "db_url", sensitive: true, value: "(sensitive)" }]);
    // a path that leads nowhere does no harm
    expect(redactedAttributes({ a: 1 }, [[{ type: "get_attr", value: "missing" }, { type: "get_attr", value: "deeper" }]])).toEqual({ a: 1 });
    expect(instancesOf(state(1), "aws_subnet.sn[0]")).toHaveLength(1);
    expect(instancesOf(state(1), "nope")).toEqual([]);
  });

  it("tells what changed between two states", () => {
    const next = state(2, [{ mode: "managed", type: "aws_eip", name: "ip", provider: PROVIDER, instances: [{ attributes: { id: "eip-1" } }] }]);
    next.resources = next.resources.filter((r) => (r as { type: string }).type !== "aws_subnet");
    (next.resources[0] as { instances: { attributes: Record<string, unknown> }[] }).instances[0]!.attributes.cidr_block = "10.1.0.0/16";
    expect(diffStates(state(1), next)).toEqual({ added: ["aws_eip.ip"], removed: ['aws_subnet.sn["b"]', "aws_subnet.sn[0]"], changed: ["aws_vpc.main"] });
    expect(diffStates(null, state(1)).added).toHaveLength(5);
  });
});

const available = await postgresAvailable();

describe.skipIf(!available)("the state viewer API", () => {
  let t: TestApp;
  let admin: string;
  let alice: { id: string; cookie: string };
  let reader: { id: string; cookie: string };
  let writer: { id: string; cookie: string };
  let outsider: { id: string; cookie: string };
  let projectId: string;
  const ids: number[] = [];

  const store = async (serial: number, s: object, withSummary: boolean) => {
    const text = JSON.stringify(s);
    const sealed = seal(t.config.stateKey!, Buffer.from(text));
    const row = await t.db.insertInto("state_versions").values({ project_id: projectId, serial, lineage: "abc", key_id: sealed.keyId, nonce: sealed.nonce, data: sealed.data, ...(withSummary ? summarizeState(s, text.length) : {}) }).returning("id").executeTakeFirstOrThrow();
    ids.push(row.id);
  };

  beforeAll(async () => {
    t = await testApp();
    admin = await t.admin();
    alice = await addMember(t, admin, "alice", ["ProjectEditor"]);
    reader = await addMember(t, admin, "reader");
    writer = await addMember(t, admin, "writer");
    outsider = await addMember(t, admin, "outsider");
    projectId = (await t.call("POST", "/api/projects", { cookie: alice.cookie, body: { design: blankDesign("Viewed") } })).body.project.id;
    await t.db.insertInto("project_shares").values({ project_id: projectId, user_id: reader.id, group_id: null, role: "custom", actions: ["project:Read", "state:Read"] }).execute();
    await t.db.insertInto("project_shares").values({ project_id: projectId, user_id: writer.id, group_id: null, role: "custom", actions: ["project:Read", "state:Read", "state:Write"] }).execute();
    await store(1, state(1), true);
    // an older row has no summary yet
    await store(2, state(2, [{ mode: "managed", type: "aws_eip", name: "ip", provider: PROVIDER, instances: [{ attributes: { id: "eip-1" } }] }]), false);
  });
  afterAll(async () => { await t.close(); });

  const get = (path: string, cookie: string) => t.call("GET", `/api/projects/${projectId}/state/${path}`, { cookie });

  it("lists the versions newest first, filling in the summary of an older one", async () => {
    const r = await get("versions", reader.cookie);
    expect(r.status).toBe(200);
    expect(r.body.versions.map((v: any) => [v.serial, v.resources, v.outputs])).toEqual([[2, 6, 2], [1, 5, 2]]);
    expect(r.body.versions[0].bytes).toBeGreaterThan(100);
    const row = await t.db.selectFrom("state_versions").select("resources").where("id", "=", ids[1]!).executeTakeFirstOrThrow();
    expect(row.resources).toBe(6);
  });

  it("shows resources and outputs without secrets, one resource's attributes, and a diff", async () => {
    const v = await get(`versions/${ids[1]}`, reader.cookie);
    expect(v.body.resources).toHaveLength(6);
    expect(JSON.stringify(v.body)).not.toContain("hunter2");
    expect(v.body.outputs.find((o: any) => o.name === "db_url").value).toBe("(sensitive)");
    const res = await get(`versions/${ids[1]}/resource?address=aws_db_instance.db`, reader.cookie);
    expect(res.body.instances[0].attributes.password).toBe("(sensitive)");
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|k-123/);
    expect((await get(`versions/${ids[1]}/resource?address=nope`, reader.cookie)).status).toBe(404);
    expect((await get(`versions/${ids[1]}/diff`, reader.cookie)).body).toMatchObject({ from: { serial: 1 }, to: { serial: 2 }, added: ["aws_eip.ip"], removed: [], changed: [] });
    expect((await get(`versions/${ids[0]}/diff`, reader.cookie)).body).toMatchObject({ from: null });
    expect((await get("versions/999999", reader.cookie)).status).toBe(404);
  });

  it("is for whoever may read state: a person with no such right, or no access to the project, gets nothing", async () => {
    await t.db.insertInto("project_shares").values({ project_id: projectId, user_id: outsider.id, group_id: null, ...memberOf("viewer") }).execute();
    expect((await get("versions", outsider.cookie)).status).toBe(403);
    const stranger = await addMember(t, admin, "stranger");
    expect((await get("versions", stranger.cookie)).status).toBe(404);
  });

  it("gives the clear state only to whoever may write state, in a person's session, and audits it", async () => {
    expect((await get(`versions/${ids[1]}/download`, reader.cookie)).status).toBe(403);
    const dl = await get(`versions/${ids[1]}/download`, writer.cookie);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-disposition"]).toContain("terraform-2.tfstate");
    expect(JSON.stringify(dl.body)).toContain("hunter2");
    const made = await t.call("POST", "/api/tokens", { cookie: admin, body: { name: "ci" } });
    const viaToken = await t.call("GET", `/api/projects/${projectId}/state/versions/${ids[1]}/download`, { csrf: false, headers: { authorization: `Bearer ${made.body.secret}` } });
    expect(viaToken.body.error.code).toBe("session_required");
    const log = JSON.stringify(await t.db.selectFrom("audit_log").select(["action", "details"]).where("action", "=", "state.downloaded").execute());
    expect(log).toContain("\"serial\":2");
    expect(log).not.toContain("hunter2");
  });
});

import { describe, expect, it } from "vitest";
import { getRegistry } from "@av2i/registry";
import { addNode, getIn, removeNodes, setIn, subtree } from "../src/logic/design.ts";
import { analyze, worstByNode } from "../src/logic/analyze.ts";
import { fieldsOf, parseInput } from "../src/logic/form.ts";
import * as H from "../src/logic/history.ts";
import { absolute, containerAt, nearestFree, placeFree, sizeOf, tidy, withPositions } from "../src/logic/layout.ts";
import { canPlace, connect, findParent } from "../src/logic/placement.ts";
import { blankDesign, fromTemplate, templates } from "../src/logic/templates.ts";
import { PALETTE } from "../src/registry.ts";
import { strings } from "../src/i18n.ts";

const reg = getRegistry();

describe("placement", () => {
  it("lets a subnet go in a VPC and an instance in a subnet", () => {
    expect(canPlace(reg, "vpc", "subnet").ok).toBe(true);
    expect(canPlace(reg, "subnet", "ec2").ok).toBe(true);
  });
  it("refuses an instance in a VPC, and a subnet at the top level, with a reason", () => {
    const a = canPlace(reg, "vpc", "ec2");
    expect(a.ok).toBe(false);
    const b = canPlace(reg, null, "subnet");
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason.vi.length).toBeGreaterThan(0);
  });
  it("allows a VPC and an Elastic IP at the top level", () => {
    expect(canPlace(reg, null, "vpc").ok).toBe(true);
    expect(canPlace(reg, null, "elastic-ip").ok).toBe(true);
  });
  it("finds a parent for a new node", () => {
    const d = fromTemplate(reg, "ec2-in-vpc");
    expect(findParent(reg, d, "ec2", "app_a")).toBe("app_a");
    expect(findParent(reg, d, "vpc")).toBeNull();
    expect(findParent(reg, blankDesign(), "ec2")).toBeUndefined();
  });
});

describe("connect", () => {
  const d = fromTemplate(reg, "ec2-in-vpc");
  it("orients a route from the table and gives gateways a default destination", () => {
    const r = connect(reg, d, "igw", "rt_app");
    expect(r.ok && r.edge).toMatchObject({ mechanism: "route", from: "rt_app", to: "igw", props: { destination_cidr_block: "0.0.0.0/0" } });
  });
  it("gives an endpoint route no destination", () => {
    const r = connect(reg, d, "rt_public", "s3ep");
    expect(r.ok && r.edge.props).toBeUndefined();
  });
  it("orients sg-attach from the group", () => {
    const x = addNode(reg, d, "security-group", "vpc", undefined);
    const r = connect(reg, x.design, "app", x.key);
    expect(r.ok && r.edge).toMatchObject({ mechanism: "sg-attach", from: x.key, to: "app" });
  });
  it("refuses unrelated services and duplicates", () => {
    expect(connect(reg, d, "vpc", "app").ok).toBe(false);
    expect(connect(reg, d, "sg_app", "app").ok).toBe(false);
  });
});

describe("design edits", () => {
  it("gives new nodes unique keys that the checker accepts", () => {
    let d = blankDesign();
    d = addNode(reg, d, "vpc", null, undefined).design;
    d = addNode(reg, d, "vpc", null, undefined).design;
    expect(d.nodes.map((n) => n.key)).toEqual(["vpc", "vpc_2"]);
    expect(d.nodes[1]!.props.cidr_block).toBe("10.1.0.0/16");
  });
  it("removes a container with what is inside it and the edges that touch them", () => {
    const d = fromTemplate(reg, "ec2-in-vpc");
    expect([...subtree(d, "app_a")].sort()).toEqual(["app", "app_a"]);
    const r = removeNodes(d, ["app_a"]);
    expect(r.nodes.some((n) => n.key === "app")).toBe(false);
    expect(r.edges.some((e) => e.to === "app_a" || e.to === "app" || e.from === "app")).toBe(false);
  });
  it("sets and unsets nested props immutably", () => {
    const p = { a: { b: 1 } };
    const q = setIn(p, "a.c", 2);
    expect(q).toEqual({ a: { b: 1, c: 2 } });
    expect(p).toEqual({ a: { b: 1 } });
    expect(setIn({ a: { b: 1 } }, "a.b", undefined)).toEqual({});
    expect(getIn(q, "a.c")).toBe(2);
  });
});

describe("history", () => {
  it("undoes, redoes and drops the redo branch on a new edit", () => {
    let h = H.start(1);
    h = H.push(h, 2);
    h = H.push(h, 3);
    h = H.undo(h);
    expect(h.present).toBe(2);
    h = H.redo(h);
    expect(h.present).toBe(3);
    h = H.undo(H.undo(h));
    h = H.push(h, 9);
    expect(h.future).toEqual([]);
    expect(H.redo(h).present).toBe(9);
  });
});

describe("layout", () => {
  it("positions every node of a template without overlap inside its parent", () => {
    const d = fromTemplate(reg, "ec2-in-vpc");
    expect(d.nodes.every((n) => n.position)).toBe(true);
    const siblings = d.nodes.filter((n) => n.parent === "vpc");
    const keys = siblings.map((n) => `${n.position!.x},${n.position!.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("finds the deepest container under a point", () => {
    const d = fromTemplate(reg, "ec2-in-vpc");
    const a = absolute(d, "app");
    expect(containerAt(d, { x: a.x + 5, y: a.y + 5 }, new Set(["app"]))).toBe("app_a");
  });
});

describe("analyze", () => {
  it("generates Terraform for the sound template and attributes each resource to a node", () => {
    const a = analyze(fromTemplate(reg, "ec2-in-vpc"), reg);
    expect(a.findings).toEqual([]);
    expect(Object.keys(a.files ?? {})).toContain("network.tf");
    expect(a.resources.every((r) => a.normalized!.nodes.some((n) => n.key === r.from) || a.normalized!.edges.some((e) => e.id === r.from))).toBe(true);
  });
  it("withholds the files when there is an error and reports it per node", () => {
    const a = analyze(fromTemplate(reg, "ec2-in-vpc", "no-instance-type"), reg);
    expect(a.files).toBeNull();
    expect(worstByNode(a.findings).get("app")).toBe("error");
  });
  it("reports structural problems instead of running the rules", () => {
    const d = fromTemplate(reg, "ec2-in-vpc");
    d.nodes[0]!.service = "nope" as never;
    const a = analyze(d, reg);
    expect(a.structural.length).toBeGreaterThan(0);
    expect(a.findings).toEqual([]);
  });
  it("every template and variant analyses without throwing", () => {
    for (const t of templates(reg)) for (const v of [undefined, ...t.variants.map((x) => x.id)]) {
      expect(analyze(fromTemplate(reg, t.id, v), reg).structural).toEqual([]);
    }
  });
});

describe("form", () => {
  it("hides references, derived and out-of-scope properties", () => {
    const keys = fieldsOf(reg, "ec2").map((f) => f.key);
    expect(keys).toContain("ami");
    expect(keys).not.toContain("subnet_id");
    expect(keys).not.toContain("vpc_security_group_ids");
    expect(fieldsOf(reg, "vpc-endpoint-s3").map((f) => f.key)).toEqual(["policy"]);
  });
  it("gives security groups a rules editor and objects their fields", () => {
    expect(fieldsOf(reg, "security-group").filter((f) => f.type === "rules").map((f) => f.key)).toEqual(["ingress_rules", "egress_rules"]);
    const meta = fieldsOf(reg, "ec2").find((f) => f.key === "metadata_options");
    expect(meta?.children?.find((c) => c.key === "http_tokens")?.values).toEqual(["optional", "required"]);
  });
  it("parses typed input", () => {
    expect(parseInput("number", "8")).toBe(8);
    expect(parseInput("number", "x")).toBeInstanceOf(Error);
    expect(parseInput("json", "{\"a\":1}")).toEqual({ a: 1 });
    expect(parseInput("json", "{")).toBeInstanceOf(Error);
    expect(parseInput("string", "")).toBeUndefined();
  });
});

describe("the M3 services", () => {
  const d = fromTemplate(reg, "container-backend");

  it("every palette item adds a node the checker accepts, and has a form", () => {
    for (const item of PALETTE) {
      let design = blankDesign();
      if (item.service !== "vpc") {
        design = addNode(reg, design, "vpc", null, undefined).design;
        design = addNode(reg, design, "subnet", "vpc", undefined).design;
      }
      const parent = findParent(reg, design, item.service, "subnet", item.props);
      expect(parent, item.id).not.toBeUndefined();
      const r = addNode(reg, design, item.service, parent ?? null, undefined, item.props);
      const issues = analyze(r.design, reg).structural.filter((p) => p.where === r.key);
      expect(issues, item.id).toEqual([]);
      if (!["vpc", "subnet", "internet-gateway", "nat-gateway", "elastic-ip", "route-table", "vpc-endpoint-s3", "security-group", "ec2"].includes(item.id)) expect(fieldsOf(reg, item.service, item.props?.part).length, item.id).toBeGreaterThan(0);
    }
  });

  it("an ECS cluster sits outside every subnet and a service inside one", () => {
    expect(canPlace(reg, null, "ecs", { part: "cluster" }).ok).toBe(true);
    expect(canPlace(reg, null, "ecs", { part: "service" }).ok).toBe(false);
    expect(canPlace(reg, "subnet", "ecs", { part: "service" }).ok).toBe(true);
    expect(canPlace(reg, "vpc", "rds").ok).toBe(true);
    expect(canPlace(reg, "subnet", "rds").ok).toBe(false);
    expect(canPlace(reg, null, "rds").ok).toBe(false);
    expect(canPlace(reg, "vpc", "db-subnet-group").ok).toBe(true);
    expect(canPlace(reg, null, "db-subnet-group").ok).toBe(false);
  });

  it("shows only the properties of the part", () => {
    const keys = (part: string) => fieldsOf(reg, "ecs", part).map((f) => f.key);
    expect(keys("cluster")).toContain("container_insights");
    expect(keys("cluster")).not.toContain("cpu");
    expect(keys("service")).toContain("cpu");
    expect(fieldsOf(reg, "ecs", "service").find((f) => f.key === "cluster")?.type).toBe("node");
  });

  it("draws the new connections in the direction the matrix gives", () => {
    const is = (a: string, b: string, mechanism: string, from: string) => {
      const v = connect(reg, { ...d, edges: [] }, a, b);
      expect(v.ok, `${a} ${b}`).toBe(true);
      if (v.ok) expect([v.edge.mechanism, v.edge.from]).toEqual([mechanism, from]);
    };
    is("web", "repo", "image-source", "repo");
    is("web", "task_role", "assume-role", "task_role");
    is("files", "task_role", "grant", "task_role");
    is("db", "db_group", "db-subnet-group", "db");
    is("db_a", "db_group", "containment", "db_a");
    is("web", "db", "network-access", "web");
    is("web", "pub_a", "containment", "pub_a");
  });

  it("does not draw a containment line between a VPC and a subnet", () => {
    expect(connect(reg, d, "vpc", "pub_a").ok).toBe(false);
  });

  it("keeps the derived roles and nothing else drawn", () => {
    const a = analyze(d, reg);
    expect(a.normalized?.nodes.filter((n) => n.origin === "generated" && n.service === "iam-role").length).toBe(2);
    expect(a.files?.["iam.tf"]).toContain("aws_iam_role");
  });
});

describe("the M4 services", () => {
  const web = { ...fromTemplate(reg, "alb-web"), edges: [] as ReturnType<typeof fromTemplate>["edges"] };
  const site = { ...fromTemplate(reg, "static-site"), edges: [] as ReturnType<typeof fromTemplate>["edges"] };

  it("draws the delivery connections in the direction the matrix gives", () => {
    const is = (d: typeof web, a: string, b: string, mechanism: string, from: string) => {
      const v = connect(reg, d, a, b);
      expect(v.ok, `${a} ${b}`).toBe(true);
      if (v.ok) expect([v.edge.mechanism, v.edge.from]).toEqual([mechanism, from]);
    };
    is(web, "web", "alb", "listener-target", "alb");
    is(web, "cert", "alb", "cert-attach", "cert");
    is(web, "alb", "zone", "dns-alias", "zone");
    is(web, "alb", "logs", "resource-policy", "alb");
    is(web, "pub_a", "alb", "containment", "pub_a");
    is(site, "site", "cdn", "origin", "cdn");
    is(site, "cdn", "cert", "cert-attach", "cert");
    is(site, "cdn", "zone", "dns-alias", "zone");
  });

  it("places an ALB in a subnet and the other services at the top level", () => {
    expect(canPlace(reg, "subnet", "alb").ok).toBe(true);
    expect(canPlace(reg, null, "alb").ok).toBe(false);
    for (const s of ["acm", "route53", "cloudfront"]) expect(canPlace(reg, null, s).ok, s).toBe(true);
  });

  it("both templates analyse without errors and generate their files", () => {
    for (const id of ["alb-web", "static-site"]) {
      const a = analyze(fromTemplate(reg, id), reg);
      expect(a.structural, id).toEqual([]);
      expect(a.files, id).not.toBeNull();
    }
  });

  it("does not draw the derived validation edge", () => {
    const a = analyze(fromTemplate(reg, "static-site"), reg);
    expect(a.normalized?.edges.some((e) => e.mechanism === "cert-validation" && e.origin === "derived")).toBe(true);
  });
});

describe("container size", () => {
  const base = () => withPositions(fromTemplate(reg, templates(reg)[0]!.id));
  it("keeps a size the user set, but never below what the children need", () => {
    const d = base();
    const sub = d.nodes.find((n) => n.service === "subnet")!;
    const grown = { ...d, nodes: d.nodes.map((n) => (n.key === sub.key ? { ...n, size: { w: 900, h: 700 } } : n)) };
    expect(sizeOf(grown, sub.key)).toEqual({ w: 900, h: 700 });
    const tiny = { ...d, nodes: d.nodes.map((n) => (n.key === sub.key ? { ...n, size: { w: 10, h: 10 } } : n)) };
    expect(sizeOf(tiny, sub.key).w).toBeGreaterThanOrEqual(160);
  });
});

describe("overlaps", () => {
  const rect = (d: ReturnType<typeof withPositions>, key: string) => {
    const n = d.nodes.find((v) => v.key === key)!;
    return { ...n.position!, ...sizeOf(d, key) };
  };
  const touch = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const base = () => withPositions(fromTemplate(reg, "ec2-in-vpc"));

  it("moves a node dropped on top of a sibling to a free spot", () => {
    const d = base();
    const sub = d.nodes.find((n) => n.key === "pub_a")!;
    const kids = d.nodes.filter((n) => n.parent === sub.key);
    expect(kids.length).toBeGreaterThan(0);
    const a = kids[0]!;
    const stacked = { ...d, nodes: d.nodes.map((n) => (n.key === a.key ? { ...n, position: { ...kids[1]?.position ?? a.position! } } : n)) };
    const fixed = placeFree(stacked, a.key);
    const others = fixed.nodes.filter((n) => n.parent === sub.key && n.key !== a.key);
    for (const o of others) expect(touch(rect(fixed, a.key), rect(fixed, o.key))).toBe(false);
  });
  it("leaves a node that already fits where it is", () => {
    const d = base();
    expect(placeFree(d, "nat_a")).toBe(d);
  });
  it("tidy separates every overlapping pair among siblings and keeps a clean design as it was", () => {
    const d = base();
    const piled = { ...d, nodes: d.nodes.map((n) => (n.parent === "pub_a" ? { ...n, position: { x: 30, y: 60 } } : n)) };
    const t = tidy(piled);
    const sibs = t.nodes.filter((n) => n.parent === "pub_a");
    for (const a of sibs) for (const b of sibs) if (a.key < b.key) expect(touch(rect(t, a.key), rect(t, b.key))).toBe(false);
    expect(tidy(t).nodes.map((n) => n.position)).toEqual(t.nodes.map((n) => n.position));
  });
  it("finds a spot that clears every sibling", () => {
    const d = base();
    const at = nearestFree(d, "pub_a", { x: 30, y: 60 }, { w: 176, h: 64 });
    for (const n of d.nodes.filter((v) => v.parent === "pub_a")) expect(touch({ ...at, w: 176, h: 64 }, rect(d, n.key))).toBe(false);
  });
});

describe("strings", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix.slice(0, -1)];
  it("have the same keys in Vietnamese and English, and no empty text", () => {
    const vi = keys(strings("vi")).sort();
    const en = keys(strings("en")).sort();
    expect(en).toEqual(vi);
    const empty = (o: unknown): boolean => (typeof o === "string" ? o.trim() === "" : o && typeof o === "object" ? Object.values(o).some(empty) : false);
    expect(empty(strings("vi"))).toBe(false);
    expect(empty(strings("en"))).toBe(false);
  });
});

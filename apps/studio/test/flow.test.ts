import { describe, expect, it } from "vitest";
import { getRegistry } from "@av2i/registry";
import { analyze } from "../src/logic/analyze.ts";
import { buildFlow } from "../src/logic/flow.ts";
import { strings } from "../src/i18n.ts";
import { fromTemplate } from "../src/logic/templates.ts";

const reg = getRegistry();
const s = strings("vi");
const hide = new Set(["wiring"] as const);

describe("buildFlow", () => {
  const design = fromTemplate(reg, "ec2-in-vpc");
  const flow = buildFlow(reg, design, analyze(design, reg), null, new Set(), "vi", s);

  it("lists a parent before its children", () => {
    const order = flow.nodes.map((n) => n.id);
    for (const n of flow.nodes) if (n.parentId) expect(order.indexOf(n.parentId)).toBeLessThan(order.indexOf(n.id));
  });
  it("draws the Elastic IP of the NAT gateway as a generated node next to it", () => {
    const eip = flow.nodes.find((n) => n.id === "eip_nat_a");
    expect(eip?.data.generated).toBe(true);
    expect(eip?.draggable).toBe(false);
    expect(eip?.parentId).toBe("pub_a");
  });
  it("draws user connections and generated attachments, but not containment", () => {
    expect(flow.edges.filter((e) => !e.data!.generated).length).toBe(design.edges.length);
    expect(flow.edges.some((e) => e.data!.generated && e.data!.mechanism === "eip-attach")).toBe(true);
    expect(flow.edges.some((e) => ["containment", "igw-attach", "nat-placement"].includes(e.data!.mechanism))).toBe(false);
  });
  it("labels a route with its destination", () => {
    expect(flow.edges.find((e) => e.id === "e_rt_app_nat")?.label).toBe("0.0.0.0/0");
  });
  it("sizes containers around their children", () => {
    const vpc = flow.nodes.find((n) => n.id === "vpc")!;
    const subnet = flow.nodes.find((n) => n.id === "app_a")!;
    expect(Number(vpc.style!.width)).toBeGreaterThan(Number(subnet.style!.width));
  });
  it("marks the worst finding on a node", () => {
    const bad = fromTemplate(reg, "ec2-in-vpc", "no-instance-type");
    const f = buildFlow(reg, bad, analyze(bad, reg), null, new Set(), "vi", s);
    expect(f.nodes.find((n) => n.id === "app")?.data.severity).toBe("error");
  });

  it("sorts every drawn connection into a family and hides a family on request", () => {
    expect(flow.edges.every((e) => ["traffic", "access", "attach", "wiring"].includes(e.data!.group as string))).toBe(true);
    expect(flow.edges.some((e) => e.data!.group === "attach")).toBe(true);
    const hidden = buildFlow(reg, design, analyze(design, reg), null, new Set(), "vi", s, new Set(["attach"]));
    expect(hidden.edges.filter((e) => e.hidden).every((e) => e.data!.group === "attach")).toBe(true);
    expect(hidden.edges.some((e) => e.hidden)).toBe(true);
  });
  it("dims connections that do not touch the selected node", () => {
    const f = buildFlow(reg, design, analyze(design, reg), { kind: "node", id: "vpc" }, new Set(), "vi", s);
    for (const e of f.edges) expect(e.data!.dimmed).toBe(e.source !== "vpc" && e.target !== "vpc");
    expect(flow.edges.every((e) => !e.data!.dimmed)).toBe(true);
  });
  it("gives every mechanism a tooltip", () => {
    for (const e of flow.edges) expect(String(e.data!.hint).length).toBeGreaterThan(0);
  });

  it("tells public subnets from private ones and counts findings per node", () => {
    expect(flow.nodes.find((n) => n.id === "pub_a")!.data.subnetKind).toBe("public");
    expect(flow.nodes.find((n) => n.id === "app_a")!.data.subnetKind).toBe("private");
    expect(flow.nodes.find((n) => n.id === "vpc")!.data.subnetKind).toBeUndefined();
    const bad = fromTemplate(reg, "ec2-in-vpc", "no-instance-type");
    const f = buildFlow(reg, bad, analyze(bad, reg), null, new Set(), "vi", s);
    const hit = f.nodes.find((n) => n.data.severity)!;
    expect(hit.data.issues.count).toBeGreaterThan(0);
    expect(hit.data.issues.rules.length).toBeGreaterThan(0);
  });
  it("gives each node its nesting depth", () => {
    expect(flow.nodes.find((n) => n.id === "vpc")!.data.depth).toBe(0);
    expect(flow.nodes.find((n) => n.id === "app_a")!.data.depth).toBe(1);
  });

  it("shows security groups, route tables and Elastic IPs as chips on their owner and hides the lines", () => {
    const f = buildFlow(reg, design, analyze(design, reg), null, new Set(), "vi", s, hide);
    const nat = f.nodes.find((n) => n.id === "nat_a")!;
    expect(nat.data.badges.some((b) => b.tag === "EIP")).toBe(true);
    expect(f.nodes.find((n) => n.id === "app_a")!.data.badges.some((b) => b.tag === "RT")).toBe(true);
    const wiring = f.edges.filter((e) => e.data!.group === "wiring");
    expect(wiring.length).toBeGreaterThan(0);
    expect(wiring.every((e) => e.hidden)).toBe(true);
    expect(f.nodes.find((n) => n.id === "sg_app")!.data.compact).toBe(true);
  });
  it("still draws the hidden lines of the node you select", () => {
    const f = buildFlow(reg, design, analyze(design, reg), { kind: "node", id: "nat_a" }, new Set(), "vi", s, hide);
    const own = f.edges.filter((e) => e.data!.group === "wiring" && (e.source === "nat_a" || e.target === "nat_a"));
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((e) => !e.hidden)).toBe(true);
  });
  it("with related-only on, keeps the selection, what it touches and the containers around them", () => {
    const f = buildFlow(reg, design, analyze(design, reg), { kind: "node", id: "app" }, new Set(), "vi", s, new Set(), true);
    const shown = new Set(f.nodes.filter((n) => !n.hidden).map((n) => n.id));
    expect(shown.has("app")).toBe(true);
    expect(shown.has("app_a")).toBe(true);
    expect(shown.has("vpc")).toBe(true);
    expect(f.nodes.some((n) => n.hidden)).toBe(true);
    for (const e of f.edges.filter((e) => !e.hidden)) expect(shown.has(e.source) && shown.has(e.target)).toBe(true);
    const all = buildFlow(reg, design, analyze(design, reg), { kind: "node", id: "app" }, new Set(), "vi", s, new Set(), false);
    expect(all.nodes.some((n) => n.hidden)).toBe(false);
  });
});

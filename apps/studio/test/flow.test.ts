import { describe, expect, it } from "vitest";
import { getRegistry } from "@av2i/registry";
import { analyze } from "../src/logic/analyze.ts";
import { buildFlow } from "../src/logic/flow.ts";
import { strings } from "../src/i18n.ts";
import { fromTemplate } from "../src/logic/templates.ts";

const reg = getRegistry();
const s = strings("vi");

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
});

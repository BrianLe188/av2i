import { describe, expect, it } from "vitest";
import { getRegistry } from "@av2i/registry";
import type { Design } from "@av2i/model";
import { analyze } from "../src/logic/analyze.ts";
import { autoLayout, layoutInput } from "../src/logic/autolayout.ts";
import { visualDesign } from "../src/logic/flow.ts";
import { absolute, LEAF, sizeOf } from "../src/logic/layout.ts";
import { fromTemplate, templates } from "../src/logic/templates.ts";

const reg = getRegistry();
const designs = (): { name: string; design: Design }[] =>
  templates(reg).flatMap((t) => [undefined, ...t.variants.map((v) => v.id)].map((v) => ({ name: `${t.id}${v ? `/${v}` : ""}`, design: fromTemplate(reg, t.id, v) })));
const named = (name: string) => designs().find((d) => d.name === name)!.design;

/** What the canvas measures: a card with chips (security groups, route tables, Elastic IPs) is taller than an empty one. */
function measure(design: Design, analysis: ReturnType<typeof analyze>): Map<string, { w: number; h: number }> {
  const chips = new Map<string, number>();
  const helper = new Set(["security-group", "route-table", "elastic-ip"]);
  const service = new Map(visualDesign(design, analysis).visual.nodes.map((n) => [n.key, n.service]));
  for (const e of [...design.edges, ...(analysis.normalized?.edges ?? [])]) {
    if (!["sg-attach", "route-association", "eip-attach"].includes(e.mechanism)) continue;
    const owner = helper.has(service.get(e.from) ?? "") ? e.to : e.from;
    chips.set(owner, (chips.get(owner) ?? 0) + 1);
  }
  return new Map([...service].filter(([, svc]) => svc !== "vpc" && svc !== "subnet").map(([k]) => [k, { w: LEAF.w, h: LEAF.h + 17 * Math.min(3, chips.get(k) ?? 0) }]));
}

const apart = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

describe("auto layout", () => {
  it("leaves no two siblings overlapping and every node inside its parent, counting the nodes the engine adds and the real card heights", async () => {
    for (const { name, design } of designs()) {
      const analysis = analyze(design, reg);
      const measured = measure(design, analysis);
      const laid = await autoLayout(design, analysis, measured);
      const { visual } = visualDesign(laid, analysis);
      const rect = (key: string) => {
        const m = measured.get(key);
        const p = absolute(visual, key);
        const s = sizeOf(visual, key);
        return { ...p, w: s.w, h: m ? m.h : s.h };
      };
      for (const n of visual.nodes) {
        const siblings = visual.nodes.filter((o) => o.key !== n.key && (o.parent ?? null) === (n.parent ?? null));
        for (const o of siblings) expect(apart(rect(n.key), rect(o.key)), `${name}: ${n.key} overlaps ${o.key}`).toBe(true);
        if (n.parent) {
          const p = rect(n.parent), c = rect(n.key);
          expect(c.x >= p.x && c.y >= p.y && c.x + c.w <= p.x + p.w && c.y + c.h <= p.y + p.h, `${name}: ${n.key} sits inside ${n.parent}`).toBe(true);
        }
      }
    }
  }, 120_000);

  it("changes nothing but positions and container sizes", async () => {
    const design = named("ec2-in-vpc");
    const laid = await autoLayout(design, analyze(design, reg));
    expect(laid.edges).toEqual(design.edges);
    expect(laid.nodes.map(({ position: _p, size: _s, ...n }) => n)).toEqual(design.nodes.map(({ position: _p, size: _s, ...n }) => n));
  });

  it("gives the same answer when run twice", async () => {
    const design = named("alb-web");
    const analysis = analyze(design, reg);
    expect(await autoLayout(design, analysis)).toEqual(await autoLayout(design, analysis));
  });

  it("sets subnets out the way an architect draws them: tiers left to right, zones top to bottom", async () => {
    const design = named("container-backend");
    const laid = await autoLayout(design, analyze(design, reg));
    const at = (key: string) => absolute(laid, key);
    const zoneOf = (key: string) => String(laid.nodes.find((n) => n.key === key)!.props.availability_zone);
    expect(zoneOf("pub_a")).toMatch(/a$/);
    expect(zoneOf("pub_b")).toMatch(/b$/);
    // public, then application, then data
    expect(at("pub_a").x).toBeLessThan(at("app_a").x);
    expect(at("app_a").x).toBeLessThan(at("db_a").x);
    expect(at("pub_b").x).toBeLessThan(at("app_b").x);
    // the same tier lines up, zone a above zone b
    expect(at("pub_a").x).toBe(at("pub_b").x);
    expect(at("app_a").x).toBe(at("app_b").x);
    expect(at("pub_a").y).toBeLessThan(at("pub_b").y);
    expect(at("app_a").y).toBeLessThan(at("app_b").y);
  });

  it("does not stack unconnected subnets in one column", async () => {
    const base = named("ec2-in-vpc");
    const subnet = base.nodes.find((n) => n.service === "subnet")!;
    const extra = [1, 2, 3].map((i) => ({ ...subnet, key: `extra_${i}`, label: `Extra ${i}`, props: { ...subnet.props, cidr_block: `10.0.${100 + i}.0/24`, availability_zone: `ap-southeast-1${"abc"[i - 1]}` } }));
    const design: Design = { ...base, nodes: [...base.nodes, ...extra] };
    const laid = await autoLayout(design, analyze(design, reg));
    const xs = new Set(laid.nodes.filter((n) => n.service === "subnet").map((n) => absolute(laid, n.key).x));
    expect(xs.size).toBeGreaterThan(1);
  });

  it("does not connect containers or nesting lines, which the hierarchy already says", () => {
    const design = named("alb-web");
    const input = layoutInput(design, analyze(design, reg));
    const containers = new Set(input.nodes.filter((n) => n.container).map((n) => n.key));
    expect(input.edges.length).toBeGreaterThan(0);
    for (const e of input.edges) expect(containers.has(e.from) || containers.has(e.to), `edge ${e.id} ends at a container`).toBe(false);
  });

  it("returns an empty design untouched", async () => {
    const empty = { ...named("ec2-in-vpc"), nodes: [], edges: [] };
    expect(await autoLayout(empty, analyze(empty, reg))).toBe(empty);
  });
});

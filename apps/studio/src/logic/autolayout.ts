import type { ELK, ElkNode } from "elkjs/lib/elk-api";
import type { Design } from "@av2i/model";
import { computeFacts, Graph } from "@av2i/engine";
import type { Analysis } from "./analyze.ts";
import { visualDesign } from "./flow.ts";
import { HEADER, isContainer, LEAF, MIN, PAD } from "./layout.ts";

/** Mechanisms that only place a node inside another one: the nesting already says it, so they do not pull nodes together. */
const NESTING = new Set(["containment"]);

export interface LayoutNode {
  key: string;
  service: string;
  parent: string | null;
  container: boolean;
  /** size of a card as drawn; unused for containers, which take the size of what they hold */
  w: number;
  h: number;
  /** a subnet's tier: 1 public, 2 application, 3 data (0 for everything else) */
  tier: number;
  /** a subnet's availability zone, empty when it has none */
  zone: string;
  /** stable tie-break between siblings */
  order: string;
}

export interface LayoutInput {
  nodes: LayoutNode[];
  edges: { id: string; from: string; to: string }[];
}

export interface Arranged {
  positions: Map<string, { x: number; y: number }>;
  /** the size ELK gave each container */
  sizes: Map<string, { w: number; h: number }>;
}

const TIER_PUBLIC = 1, TIER_APP = 2, TIER_DATA = 3;
const GAP = 28;
const BETWEEN = 56;

/**
 * What the layout needs to know about a design as it is drawn: the nodes the engine added (an Elastic IP for a NAT gateway, derived roles)
 * take room too, cards have the height the canvas measured (a card with chips is taller than an empty one), and subnets carry the tier
 * and availability zone that decide where an architect expects them.
 */
export function layoutInput(design: Design, analysis: Analysis, measured: ReadonlyMap<string, { w: number; h: number }> = new Map()): LayoutInput {
  const { visual, generated } = visualDesign(design, analysis);
  const designKeys = new Set(design.nodes.map((n) => n.key));
  const anchorOf = new Map((analysis.normalized?.nodes ?? []).map((n) => [n.key, n.because]));
  // A node the engine added (the Elastic IP of a NAT gateway) is drawn just under what caused it, and a derived role in a column on the
  // right of everything. So the first folds into its anchor's box, which keeps the room below it free, and the second takes no part.
  const folded = new Map<string, number>();
  const skip = new Set<string>();
  for (const key of generated) {
    const n = visual.nodes.find((v) => v.key === key)!;
    const anchor = designKeys.has(anchorOf.get(key) ?? "") ? visual.nodes.find((v) => v.key === anchorOf.get(key)) : undefined;
    if (n.service === "iam-role") { skip.add(key); continue; }
    if (anchor && (anchor.parent ?? null) === (n.parent ?? null) && !isContainer(anchor.service)) {
      skip.add(key);
      folded.set(anchor.key, (folded.get(anchor.key) ?? 0) + Math.max(measured.get(key)?.h ?? 0, LEAF.h) + 24);
    }
  }
  const byKey = new Map(visual.nodes.filter((n) => !skip.has(n.key)).map((n) => [n.key, n]));
  const edges = new Map<string, { id: string; from: string; to: string }>();
  for (const e of [...design.edges, ...(analysis.normalized?.edges ?? [])]) {
    if (NESTING.has(e.mechanism) || edges.has(e.id)) continue;
    const a = byKey.get(e.from), b = byKey.get(e.to);
    // edges to a container are left out: where it sits follows from what it holds
    if (!a || !b || isContainer(a.service) || isContainer(b.service)) continue;
    edges.set(e.id, { id: e.id, from: e.from, to: e.to });
  }

  let publicSubnets = new Set<string>();
  if (analysis.normalized) {
    try {
      const facts = computeFacts(new Graph(analysis.normalized));
      publicSubnets = new Set([...facts.subnets].filter(([, f]) => f.public).map(([k]) => k));
    } catch { /* an unfinished design has no facts: its subnets are placed by name */ }
  }
  // a database sits in one subnet and reaches the others of its subnet group by a line, so the subnets on either end hold data
  const dataSubnets = new Set<string>();
  for (const n of visual.nodes) {
    if (n.service !== "rds") continue;
    if (n.parent) dataSubnets.add(n.parent);
    for (const e of design.edges) {
      const other = e.from === n.key ? e.to : e.to === n.key ? e.from : null;
      if (other && visual.nodes.find((v) => v.key === other)?.service === "subnet") dataSubnets.add(other);
    }
  }
  const holdsData = (key: string) => dataSubnets.has(key);
  const tierOf = (key: string) => (publicSubnets.has(key) ? TIER_PUBLIC : holdsData(key) ? TIER_DATA : TIER_APP);

  const nodes = visual.nodes.filter((n) => !skip.has(n.key)).map((n): LayoutNode => {
    const container = isContainer(n.service);
    const size = measured.get(n.key);
    return {
      key: n.key,
      service: n.service,
      parent: n.parent && byKey.has(n.parent) ? n.parent : null,
      container,
      w: size?.w ?? LEAF.w,
      // room for what is drawn under it: the card itself is at least as tall as the gap the canvas leaves for the node below
      h: Math.max(size?.h ?? 0, LEAF.h) + (folded.has(n.key) ? Math.max(0, LEAF.h + 24 - Math.max(size?.h ?? 0, LEAF.h)) + folded.get(n.key)! : 0),
      tier: n.service === "subnet" ? tierOf(n.key) : 0,
      zone: n.service === "subnet" ? String(n.props.availability_zone ?? "") : "",
      order: `${String(n.props.availability_zone ?? "")}\u0000${n.label}`,
    };
  });
  return { nodes, edges: [...edges.values()] };
}


const FLAT = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": String(GAP),
  "elk.layered.spacing.nodeNodeBetweenLayers": String(BETWEEN),
  "elk.spacing.componentComponent": "40",
  // keep the order the nodes were given in where nothing else decides, so the result does not jump around between runs
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.padding": "[top=0,left=0,bottom=0,right=0]",
};

type Box = { w: number; h: number };

/**
 * Lays the design out one level at a time, innermost first: a container is sized by what it holds, then sits as a fixed box among its
 * siblings. ELK arranges the boxes of a level by what is connected; the subnets of a network are set in a grid instead, tiers left to
 * right (public, application, data) and availability zones top to bottom, because that is how an architect draws them.
 */
export async function arrange(input: LayoutInput, elk: Pick<ELK, "layout">): Promise<Arranged> {
  const byKey = new Map(input.nodes.map((n) => [n.key, n]));
  const kidsOf = (parent: string | null) => input.nodes.filter((n) => n.parent === parent).sort((a, b) => a.order.localeCompare(b.order));
  /** the child of `parent` that holds `key`, or null when it is not below it */
  const under = (parent: string | null, key: string): string | null => {
    for (let k: string | null = key; k; k = byKey.get(k)?.parent ?? null) if ((byKey.get(k)?.parent ?? null) === parent) return k;
    return null;
  };
  const sizes = new Map<string, Box>();
  const positions = new Map<string, { x: number; y: number }>();
  const containerSizes = new Map<string, Box>();

  /** ELK on a flat list of boxes joined by the edges between them; positions from the top left corner of the result. */
  async function flat(parent: string | null, keys: string[]): Promise<{ at: Map<string, { x: number; y: number }>; w: number; h: number }> {
    const set = new Set(keys);
    const seen = new Set<string>();
    const edges: { id: string; sources: string[]; targets: string[] }[] = [];
    for (const e of input.edges) {
      const a = under(parent, e.from), b = under(parent, e.to);
      if (!a || !b || a === b || !set.has(a) || !set.has(b) || seen.has(`${a}>${b}`)) continue;
      seen.add(`${a}>${b}`);
      edges.push({ id: e.id, sources: [a], targets: [b] });
    }
    const graph: ElkNode = { id: "level", layoutOptions: FLAT, children: keys.map((k) => ({ id: k, width: sizes.get(k)!.w, height: sizes.get(k)!.h })), edges };
    const laid = await elk.layout(graph);
    const at = new Map((laid.children ?? []).map((c) => [c.id, { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0) }]));
    return { at, w: Math.ceil(laid.width ?? 0), h: Math.ceil(laid.height ?? 0) };
  }

  /** Subnets in a grid: a column per tier, a row per zone (or per position in the tier when zones are not set). */
  function grid(subnets: LayoutNode[]): { at: Map<string, { x: number; y: number }>; w: number; h: number } {
    const tiers = [...new Set(subnets.map((n) => n.tier))].sort((a, b) => a - b);
    const zones = [...new Set(subnets.map((n) => n.zone).filter(Boolean))].sort();
    const rowOf = new Map<string, number>();
    const seenInTier = new Map<number, number>();
    for (const n of subnets) {
      if (n.zone) { rowOf.set(n.key, zones.indexOf(n.zone)); continue; }
      const i = seenInTier.get(n.tier) ?? 0;
      seenInTier.set(n.tier, i + 1);
      rowOf.set(n.key, zones.length + i);
    }
    // two subnets of one tier and zone must not share a cell: the later one gets a row of its own
    const taken = new Set<string>();
    let next = Math.max(-1, ...rowOf.values()) + 1;
    for (const n of subnets) {
      const cell = `${n.tier}:${rowOf.get(n.key)}`;
      if (taken.has(cell)) rowOf.set(n.key, next++);
      taken.add(`${n.tier}:${rowOf.get(n.key)}`);
    }
    const rows = Math.max(0, ...rowOf.values()) + 1;
    const colW = tiers.map((t) => Math.max(...subnets.filter((n) => n.tier === t).map((n) => sizes.get(n.key)!.w)));
    const rowH = Array.from({ length: rows }, (_, r) => Math.max(0, ...subnets.filter((n) => rowOf.get(n.key) === r).map((n) => sizes.get(n.key)!.h)));
    const colX = colW.map((_, i) => colW.slice(0, i).reduce((x, w) => x + w + BETWEEN, 0));
    const rowY = rowH.map((_, i) => rowH.slice(0, i).reduce((y, h) => y + h + GAP, 0));
    const at = new Map(subnets.map((n) => [n.key, { x: colX[tiers.indexOf(n.tier)]!, y: rowY[rowOf.get(n.key)!]! }]));
    return { at, w: colW.reduce((x, w) => x + w, 0) + BETWEEN * Math.max(0, colW.length - 1), h: rowH.reduce((y, h) => y + h, 0) + GAP * Math.max(0, rows - 1) };
  }

  async function level(parent: string | null): Promise<Box> {
    const kids = kidsOf(parent);
    for (const k of kids) {
      if (k.container) sizes.set(k.key, await level(k.key));
      else sizes.set(k.key, { w: k.w, h: k.h });
    }
    if (kids.length === 0) {
      // an empty container is still as big as an empty container is drawn
      if (parent === null) return { w: 0, h: 0 };
      const min = MIN[byKey.get(parent)!.service] ?? { w: 260, h: 180 };
      containerSizes.set(parent, min);
      return min;
    }
    const subnets = kids.filter((k) => k.service === "subnet");
    let w: number, h: number;
    if (subnets.length >= 2) {
      const others = kids.filter((k) => k.service !== "subnet");
      const beside = others.length ? await flat(parent, others.map((k) => k.key)) : { at: new Map(), w: 0, h: 0 };
      const g = grid(subnets);
      const dx = others.length ? beside.w + BETWEEN : 0;
      for (const [k, p] of beside.at) positions.set(k, p);
      for (const [k, p] of g.at) positions.set(k, { x: p.x + dx, y: p.y });
      w = dx + g.w;
      h = Math.max(beside.h, g.h);
    } else {
      const r = await flat(parent, kids.map((k) => k.key));
      for (const [k, p] of r.at) positions.set(k, p);
      w = r.w;
      h = r.h;
    }
    if (parent === null) {
      for (const k of kids) { const p = positions.get(k.key)!; positions.set(k.key, { x: p.x + 8, y: p.y + 8 }); }
      return { w: w + 16, h: h + 16 };
    }
    // inside a container: leave room for its header on top and a margin around the rest
    for (const k of kids) { const p = positions.get(k.key)!; positions.set(k.key, { x: p.x + PAD, y: p.y + HEADER }); }
    const min = MIN[byKey.get(parent)!.service] ?? { w: 260, h: 180 };
    const box = { w: Math.max(min.w, w + 2 * PAD), h: Math.max(min.h, h + HEADER + PAD) };
    containerSizes.set(parent, box);
    return box;
  }

  await level(null);
  return { positions, sizes: containerSizes };
}

/** Writes an arrangement onto the design's own nodes; the nodes the engine added have no home in the design and are placed beside their anchor when drawn. */
export function applyArranged(design: Design, arranged: Arranged): Design {
  return {
    ...design,
    nodes: design.nodes.map((n) => {
      const p = arranged.positions.get(n.key);
      if (!p) return n;
      const size = arranged.sizes.get(n.key);
      return { ...n, position: { x: Math.max(8, p.x), y: n.parent ? Math.max(HEADER, p.y) : Math.max(8, p.y) }, ...(size ? { size } : {}) };
    }),
  };
}

/** Arranges the whole design: connected nodes close together, flow from left to right, subnets by tier and zone, containers sized to hold what they hold. */
export async function autoLayout(design: Design, analysis: Analysis, measured?: ReadonlyMap<string, { w: number; h: number }>): Promise<Design> {
  if (design.nodes.length === 0) return design;
  // loaded on first use: the library is large and most sessions never press the button
  const { default: Elk } = await import("elkjs/lib/elk.bundled.js");
  return applyArranged(design, await arrange(layoutInput(design, analysis, measured), new Elk()));
}

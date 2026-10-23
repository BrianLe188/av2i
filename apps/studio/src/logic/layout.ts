import type { Design } from "@av2i/model";
import { CONTAINERS } from "./placement.ts";

export const LEAF = { w: 150, h: 56 };
const MIN: Record<string, { w: number; h: number }> = { vpc: { w: 520, h: 300 }, subnet: { w: 230, h: 170 } };
const PAD = 24;
const HEADER = 44;

export const isContainer = (service: string) => CONTAINERS.includes(service);

type Rect = { x: number; y: number; w: number; h: number };
type Pos = Map<string, { x: number; y: number }>;

function positions(design: Design): Pos {
  return new Map(design.nodes.filter((n) => n.position).map((n) => [n.key, n.position!]));
}

/** Size of a node: leaves are fixed, containers grow to hold their children. */
export function sizeOf(design: Design, key: string, pos: Pos = positions(design)): { w: number; h: number } {
  const node = design.nodes.find((n) => n.key === key);
  if (!node || !isContainer(node.service)) return LEAF;
  const min = MIN[node.service] ?? { w: 260, h: 180 };
  let w = min.w, h = min.h;
  for (const c of design.nodes.filter((n) => n.parent === key)) {
    const p = pos.get(c.key);
    if (!p) continue;
    const s = sizeOf(design, c.key, pos);
    w = Math.max(w, p.x + s.w + PAD);
    h = Math.max(h, p.y + s.h + PAD);
  }
  return { w, h };
}

/** Position of a node's top-left corner on the canvas. */
export function absolute(design: Design, key: string): { x: number; y: number } {
  let x = 0, y = 0;
  for (let n = design.nodes.find((v) => v.key === key); n; n = n.parent ? design.nodes.find((v) => v.key === n!.parent) : undefined) {
    x += n.position?.x ?? 0;
    y += n.position?.y ?? 0;
  }
  return { x, y };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w + 16 && b.x < a.x + a.w + 16 && a.y < b.y + b.h + 16 && b.y < a.y + a.h + 16;

/** First free spot, scanning rows from the top left of the parent, for something of size `s`. */
function firstFree(taken: Rect[], s: { w: number; h: number }, maxX: number): { x: number; y: number } {
  for (let y = HEADER; ; y += 20) {
    for (let x = PAD; x <= maxX - s.w; x += 20) {
      if (!taken.some((t) => overlaps({ x, y, ...s }, t))) return { x, y };
    }
    if (y > 4000) return { x: PAD, y };
  }
}

/** Fill in the position of every node that has none, children before the containers that hold them. */
export function withPositions(design: Design): Design {
  const pos = positions(design);
  const done = (parent: string | null) => {
    const kids = design.nodes.filter((n) => (n.parent ?? null) === parent);
    for (const k of kids) if (isContainer(k.service)) done(k.key);
    const maxX = parent === null ? 1500 : 3 * (LEAF.w + 20) + PAD;
    const taken: Rect[] = kids.filter((k) => pos.has(k.key)).map((k) => ({ ...pos.get(k.key)!, ...sizeOf(design, k.key, pos) }));
    // leaves first so they form the top band, then containers below
    for (const k of [...kids.filter((v) => !isContainer(v.service)), ...kids.filter((v) => isContainer(v.service))]) {
      if (pos.has(k.key)) continue;
      const s = sizeOf(design, k.key, pos);
      const p = parent === null && !isContainer(k.service)
        ? firstFree(taken, s, 1500)
        : firstFree(taken, s, parent === null ? 1500 : Math.max(maxX, 2 * 260 + PAD));
      pos.set(k.key, p);
      taken.push({ ...p, ...s });
    }
  };
  done(null);
  return { ...design, nodes: design.nodes.map((n) => (n.position ? n : { ...n, position: pos.get(n.key)! })) };
}

/** The deepest container whose area holds the point, ignoring the nodes in `skip`. */
export function containerAt(design: Design, point: { x: number; y: number }, skip: ReadonlySet<string> = new Set()): string | null {
  const pos = positions(design);
  let best: { key: string; depth: number } | null = null;
  for (const n of design.nodes) {
    if (!isContainer(n.service) || skip.has(n.key)) continue;
    const a = absolute(design, n.key);
    const s = sizeOf(design, n.key, pos);
    if (point.x >= a.x && point.x <= a.x + s.w && point.y >= a.y && point.y <= a.y + s.h) {
      let depth = 0;
      for (let p = n.parent; p; p = design.nodes.find((v) => v.key === p)?.parent) depth++;
      if (!best || depth > best.depth) best = { key: n.key, depth };
    }
  }
  return best?.key ?? null;
}

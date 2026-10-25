import type { Design } from "@av2i/model";
import { CONTAINERS } from "./placement.ts";

export const LEAF = { w: 176, h: 64 };
export const MIN: Record<string, { w: number; h: number }> = { vpc: { w: 520, h: 300 }, subnet: { w: 290, h: 180 } };
export const PAD = 24;
const FLOOR = { w: 160, h: 100 };
export const HEADER = 44;

export const isContainer = (service: string) => CONTAINERS.includes(service);

type Rect = { x: number; y: number; w: number; h: number };
type Pos = Map<string, { x: number; y: number }>;

function positions(design: Design): Pos {
  return new Map(design.nodes.filter((n) => n.position).map((n) => [n.key, n.position!]));
}

/** Smallest a container may be: it must still hold its children. */
export function fitOf(design: Design, key: string, pos: Pos = positions(design)): { w: number; h: number } {
  let w = FLOOR.w, h = FLOOR.h;
  for (const c of design.nodes.filter((n) => n.parent === key)) {
    const p = pos.get(c.key);
    if (!p) continue;
    const s = sizeOf(design, c.key, pos);
    w = Math.max(w, p.x + s.w + PAD);
    h = Math.max(h, p.y + s.h + PAD);
  }
  return { w, h };
}

/** Size of a node: leaves are fixed, containers take the size the user gave them or grow to hold their children. */
export function sizeOf(design: Design, key: string, pos: Pos = positions(design)): { w: number; h: number } {
  const node = design.nodes.find((n) => n.key === key);
  if (!node || !isContainer(node.service)) return LEAF;
  const fit = fitOf(design, key, pos);
  if (node.size) return { w: Math.max(node.size.w, fit.w), h: Math.max(node.size.h, fit.h) };
  const min = MIN[node.service] ?? { w: 260, h: 180 };
  return { w: Math.max(min.w, fit.w), h: Math.max(min.h, fit.h) };
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

const MARGIN = 12;
const clear = (a: Rect, b: Rect) => a.x + a.w + MARGIN <= b.x || b.x + b.w + MARGIN <= a.x || a.y + a.h + MARGIN <= b.y || b.y + b.h + MARGIN <= a.y;

/** The sibling rectangles a node must not overlap, relative to their shared parent. */
function siblingRects(design: Design, parent: string | null, skip: string, only?: ReadonlySet<string>): Rect[] {
  const pos = positions(design);
  return design.nodes
    .filter((n) => (n.parent ?? null) === parent && n.key !== skip && pos.has(n.key) && (!only || only.has(n.key)))
    .map((n) => ({ ...pos.get(n.key)!, ...sizeOf(design, n.key, pos) }));
}

/** The free spot closest to `want` among the siblings in `parent`, scanning outwards on a 20px grid. */
export function nearestFree(
  design: Design, parent: string | null, want: { x: number; y: number }, size: { w: number; h: number }, skip = "", only?: ReadonlySet<string>,
): { x: number; y: number } {
  const taken = siblingRects(design, parent, skip, only);
  const x0 = Math.max(8, want.x), y0 = Math.max(HEADER, want.y);
  const ok = (x: number, y: number) => x >= 8 && y >= HEADER && taken.every((t) => clear({ x, y, ...size }, t));
  if (ok(x0, y0)) return { x: x0, y: y0 };
  for (let r = 1; r <= 80; r++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx * 20, y = y0 + dy * 20;
        if (!ok(x, y)) continue;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  return { x: x0, y: y0 };
}

/** Move one node to the nearest free spot among its siblings, leaving it where it is when it already fits. */
export function placeFree(design: Design, key: string): Design {
  const node = design.nodes.find((n) => n.key === key);
  if (!node?.position) return design;
  const spot = nearestFree(design, node.parent ?? null, node.position, sizeOf(design, key), key);
  if (spot.x === node.position.x && spot.y === node.position.y) return design;
  return { ...design, nodes: design.nodes.map((n) => (n.key === key ? { ...n, position: spot } : n)) };
}

/** Separate every overlapping pair: deepest containers first so their sizes are settled before their siblings are checked. */
export function tidy(design: Design): Design {
  let d = withPositions(design);
  const depthOf = (key: string) => { let n = 0; for (let p = d.nodes.find((v) => v.key === key)?.parent; p; p = d.nodes.find((v) => v.key === p)?.parent) n++; return n; };
  const groups = [...new Set(d.nodes.map((n) => n.parent ?? null))].sort((a, b) => (b === null ? -1 : depthOf(b)) - (a === null ? -1 : depthOf(a)));
  for (const parent of groups) {
    const kids = d.nodes.filter((n) => (n.parent ?? null) === parent).sort((a, b) => a.position!.y - b.position!.y || a.position!.x - b.position!.x);
    const placed = new Set<string>();
    for (const k of kids) {
      const cur = d.nodes.find((n) => n.key === k.key)!;
      const spot = nearestFree(d, parent, cur.position!, sizeOf(d, k.key), k.key, placed);
      if (spot.x !== cur.position!.x || spot.y !== cur.position!.y) d = { ...d, nodes: d.nodes.map((n) => (n.key === k.key ? { ...n, position: spot } : n)) };
      placed.add(k.key);
    }
  }
  return d;
}

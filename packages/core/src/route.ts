import { absolutePosition, ancestorsOf } from './graph';
import { RESOURCES } from './resources';
import type { GraphNode, Point } from './types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RouterNode {
  id: string;
  /** Absolute position and size. */
  rect: Rect;
  /** Containers (VPC, subnet) can be crossed; everything else is an obstacle. */
  container: boolean;
}

export interface RouterEdge {
  id: string;
  source: string;
  target: string;
}

export interface RouteOptions {
  /** Grid resolution in pixels. */
  cell?: number;
}

/** Router input for a graph: absolute rectangles for every node. */
export function routerNodes(nodes: GraphNode[]): RouterNode[] {
  return nodes.map((n) => {
    const p = absolutePosition(nodes, n.id);
    return { id: n.id, rect: { x: p.x, y: p.y, width: n.size.width, height: n.size.height }, container: RESOURCES[n.type].kind === 'container' };
  });
}

// Directions: 0 up, 1 right, 2 down, 3 left.
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

const STEP = 1;
const TURN = 5;
/** Running right next to something that isn't the edge's own endpoint. */
const HALO = 3;
/** Sharing a lane with another edge going the same way. */
const OVERLAP = 14;
/** Cutting across another edge. */
const CROSSING = 4;
/** Entering or leaving a container (VPC, subnet) that isn't needed to get there. */
const BOUNDARY = 8;
/** Leaving a node from the side that faces away from the other end. */
const FACING_AWAY = 12;
/** Clear distance, in cells, between a node and the first bend of an edge. */
const STUB = 2;

class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }
  pop(): [number, number] {
    const { keys, vals } = this;
    const topK = keys[0];
    const topV = vals[0];
    const lastK = keys.pop()!;
    const lastV = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastK) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = lastK;
      vals[i] = lastV;
    }
    return [topK, topV];
  }
}

interface CellRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Orthogonal routes for connections: right-angled paths that keep clear of every resource that isn't one
 * of the connection's ends, stay inside containers where they can, and avoid running along each other.
 * Returns the polyline of each edge in absolute coordinates, from the border of the source to the border
 * of the target. Pure and deterministic, so it can be recomputed whenever the layout changes.
 */
export function routeEdges(nodes: RouterNode[], edges: RouterEdge[], opts: RouteOptions = {}): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  if (edges.length === 0 || nodes.length === 0) return out;
  const C = opts.cell ?? 10;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const margin = 12 * C;
  const minX = Math.min(...nodes.map((n) => n.rect.x)) - margin;
  const minY = Math.min(...nodes.map((n) => n.rect.y)) - margin;
  const maxX = Math.max(...nodes.map((n) => n.rect.x + n.rect.width)) + margin;
  const maxY = Math.max(...nodes.map((n) => n.rect.y + n.rect.height)) + margin;
  const W = Math.ceil((maxX - minX) / C);
  const H = Math.ceil((maxY - minY) / C);
  const N = W * H;

  const cellRect = (r: Rect): CellRect => ({
    x0: Math.floor((r.x - minX) / C),
    y0: Math.floor((r.y - minY) / C),
    x1: Math.ceil((r.x + r.width - minX) / C) - 1,
    y1: Math.ceil((r.y + r.height - minY) / C) - 1,
  });
  const rects = new Map(nodes.map((n) => [n.id, cellRect(n.rect)]));
  const idx = (x: number, y: number) => y * W + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

  const leaves = nodes.filter((n) => !n.container);
  const leafIndex = new Map(leaves.map((n, i) => [n.id, i]));
  // Which leaf covers a cell (solid) or sits next to it (halo), -1 for none.
  const solid = new Int32Array(N).fill(-1);
  const halo = new Int32Array(N).fill(-1);
  for (const n of leaves) {
    const r = rects.get(n.id)!;
    const i = leafIndex.get(n.id)!;
    for (let y = r.y0 - 1; y <= r.y1 + 1; y++) {
      for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
        if (!inside(x, y)) continue;
        const c = idx(x, y);
        const core = x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
        if (core) solid[c] = i;
        else if (halo[c] < 0) halo[c] = i;
      }
    }
  }
  // Innermost container of each cell, to charge for crossing container borders.
  const home = new Int32Array(N).fill(-1);
  const boxes = nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.container)
    .sort((a, b) => b.n.rect.width * b.n.rect.height - a.n.rect.width * a.n.rect.height);
  for (const { n, i } of boxes) {
    const r = rects.get(n.id)!;
    for (let y = Math.max(0, r.y0); y <= Math.min(H - 1, r.y1); y++) for (let x = Math.max(0, r.x0); x <= Math.min(W - 1, r.x1); x++) home[idx(x, y)] = i;
  }
  const containersOf = (id: string) => {
    // The node itself (if a container) and the containers around it.
    const self = byId.get(id)!;
    const set = new Set<number>();
    const r = self.rect;
    nodes.forEach((n, i) => {
      if (!n.container) return;
      const o = n.rect;
      const covers = o.x <= r.x && o.y <= r.y && o.x + o.width >= r.x + r.width && o.y + o.height >= r.y + r.height;
      if (covers) set.add(i);
    });
    return set;
  };

  // How many routed edges already run through a cell, horizontally and vertically.
  const usedH = new Uint8Array(N);
  const usedV = new Uint8Array(N);

  const dist = new Float32Array(N * 4);
  const from = new Int32Array(N * 4);

  interface Port {
    cell: number;
    side: number; // direction pointing away from the node
  }

  /** Cells `STUB` away from the node's border, on every side, tagged with the side they belong to. */
  const portsOf = (id: string): Port[] => {
    const r = rects.get(id)!;
    const ports: Port[] = [];
    const add = (x: number, y: number, side: number) => {
      if (inside(x, y) && solid[idx(x, y)] < 0) ports.push({ cell: idx(x, y), side });
    };
    for (let x = r.x0; x <= r.x1; x++) {
      add(x, r.y0 - STUB, 0);
      add(x, r.y1 + STUB, 2);
    }
    for (let y = r.y0; y <= r.y1; y++) {
      add(r.x1 + STUB, y, 1);
      add(r.x0 - STUB, y, 3);
    }
    return ports;
  };

  const centerOf = (r: CellRect) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
  /** How much worse a side is when the other node lies behind it. */
  const awayCost = (side: number, a: CellRect, b: CellRect) => {
    const ca = centerOf(a);
    const cb = centerOf(b);
    const dot = (cb.x - ca.x) * DX[side] + (cb.y - ca.y) * DY[side];
    return dot < 0 ? FACING_AWAY : 0;
  };

  const order = edges
    .map((e, i) => {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      const d = a && b ? Math.abs(a.rect.x - b.rect.x) + Math.abs(a.rect.y - b.rect.y) : Infinity;
      return { e, i, d };
    })
    .sort((p, q) => p.d - q.d || p.i - q.i);

  for (const { e } of order) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b || a.id === b.id) continue;
    const ra = rects.get(a.id)!;
    const rb = rects.get(b.id)!;
    const startPorts = portsOf(a.id);
    const goalPorts = portsOf(b.id);
    const goalAt = new Map<number, number[]>(); // cell -> sides it can be entered from
    for (const p of goalPorts) goalAt.set(p.cell, [...(goalAt.get(p.cell) ?? []), p.side]);
    const own = new Set([leafIndex.get(a.id) ?? -2, leafIndex.get(b.id) ?? -2]);
    const ownBoxes = new Set([...containersOf(a.id), ...containersOf(b.id)]);

    dist.fill(Infinity);
    const heap = new Heap();
    const target = rb;
    const heuristic = (x: number, y: number) =>
      Math.max(target.x0 - x, 0, x - target.x1) + Math.max(target.y0 - y, 0, y - target.y1);

    for (const p of startPorts) {
      const x = p.cell % W;
      const y = (p.cell - x) / W;
      const state = p.cell * 4 + p.side;
      const cost = awayCost(p.side, ra, rb);
      if (cost < dist[state]) {
        dist[state] = cost;
        from[state] = -1;
        heap.push(cost + heuristic(x, y), state);
      }
    }

    let found = -1;
    while (heap.size > 0) {
      const [f, state] = heap.pop();
      const cell = (state / 4) | 0;
      const dir = state % 4;
      const x = cell % W;
      const y = (cell - x) / W;
      const g = dist[state];
      if (f > g + heuristic(x, y) + 1e-6) continue;
      const sides = goalAt.get(cell);
      // Arrive heading into the node: the direction of travel is opposite to the side's outward normal.
      if (sides?.some((s) => (s + 2) % 4 === dir)) {
        found = state;
        break;
      }
      for (let nd = 0; nd < 4; nd++) {
        if ((nd + 2) % 4 === dir) continue; // no U-turns
        const nx = x + DX[nd];
        const ny = y + DY[nd];
        if (!inside(nx, ny)) continue;
        const nc = idx(nx, ny);
        if (solid[nc] >= 0) continue;
        let step = STEP;
        if (nd !== dir) step += TURN;
        const hOwner = halo[nc];
        if (hOwner >= 0 && !own.has(hOwner)) step += HALO;
        const horizontal = nd === 1 || nd === 3;
        if (horizontal ? usedH[nc] > 0 : usedV[nc] > 0) step += OVERLAP * Math.min(2, horizontal ? usedH[nc] : usedV[nc]);
        else if (horizontal ? usedV[nc] > 0 : usedH[nc] > 0) step += CROSSING;
        if (home[nc] !== home[cell] && !(ownBoxes.has(home[nc]) && ownBoxes.has(home[cell]))) step += BOUNDARY;
        const ns = nc * 4 + nd;
        const ng = g + step;
        if (ng < dist[ns]) {
          dist[ns] = ng;
          from[ns] = state;
          heap.push(ng + heuristic(nx, ny), ns);
        }
      }
    }

    const toPx = (c: number): Point => {
      const x = c % W;
      return { x: minX + x * C + C / 2, y: minY + ((c - x) / W) * C + C / 2 };
    };
    let points: Point[];
    if (found < 0) {
      // Boxed in: a straight line between the borders still shows the connection.
      points = [centerPoint(a.rect), centerPoint(b.rect)];
    } else {
      const cells: number[] = [];
      for (let s = found; s !== -1; s = from[s]) cells.push((s / 4) | 0);
      cells.reverse();
      const startSide = startSideOf(found, from);
      const endSide = (found % 4 + 2) % 4;
      const raw = cells.map(toPx);
      // Mark the lanes this edge uses so later edges keep off them.
      for (let i = 0; i < cells.length; i++) {
        if (i === 0) continue;
        const dx = Math.abs(raw[i].x - raw[i - 1].x);
        if (dx > 0) usedH[cells[i]] = Math.min(255, usedH[cells[i]] + 1);
        else usedV[cells[i]] = Math.min(255, usedV[cells[i]] + 1);
      }
      if (cells.length > 0) {
        const first = cells[0];
        const dir = startSide;
        if (dir === 0 || dir === 2) usedV[first] = Math.min(255, usedV[first] + 1);
        else usedH[first] = Math.min(255, usedH[first] + 1);
      }
      const start = borderPoint(a.rect, raw[0], startSide);
      const end = borderPoint(b.rect, raw[raw.length - 1], endSide);
      points = simplify([start, ...raw, end]);
    }
    out.set(e.id, points);
  }
  return out;
}

const centerPoint = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** The side a route leaves its source from: the search starts every port heading away from its side. */
function startSideOf(found: number, from: Int32Array): number {
  let s = found;
  while (from[s] !== -1) s = from[s];
  return s % 4;
}

/** Point where a straight line from `cell` toward the node meets its border on `side`. */
function borderPoint(r: Rect, cell: Point, side: number): Point {
  switch (side) {
    case 0:
      return { x: cell.x, y: r.y };
    case 2:
      return { x: cell.x, y: r.y + r.height };
    case 1:
      return { x: r.x + r.width, y: cell.y };
    default:
      return { x: r.x, y: cell.y };
  }
}

/** Drops points that sit on a straight run between their neighbours. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

/** SVG path through `points` with rounded corners. */
export function pathFromPoints(points: Point[], radius = 8): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1];
    const c = points[i];
    const n = points[i + 1];
    const r = Math.min(radius, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    const ux = Math.sign(c.x - p.x);
    const uy = Math.sign(c.y - p.y);
    const vx = Math.sign(n.x - c.x);
    const vy = Math.sign(n.y - c.y);
    d += ` L ${c.x - ux * r} ${c.y - uy * r} Q ${c.x} ${c.y} ${c.x + vx * r} ${c.y + vy * r}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** Where to put a label: the middle of the longest straight run. */
export function labelPoint(points: Point[]): Point {
  let best = { len: -1, x: points[0]?.x ?? 0, y: points[0]?.y ?? 0 };
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (len > best.len) best = { len, x: (points[i].x + points[i - 1].x) / 2, y: (points[i].y + points[i - 1].y) / 2 };
  }
  return { x: best.x, y: best.y };
}

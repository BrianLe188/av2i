import { nextSubnetCidr } from './cidr';
import { availabilityZones, RESOURCES } from './resources';
import { stripReferences } from './sg-rules';
import type { Graph, GraphNode, Point, PropValue, ResourceType, Size } from './types';

/** Inner margin of a container, and room reserved for its title bar. */
export const PAD = 20;
export const PAD_TOP = 44;
const GAP = 16;

export function newId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

export function depthOf(nodes: GraphNode[], id: string): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let depth = 0;
  let cur = byId.get(id);
  while (cur?.parentId) {
    depth++;
    cur = byId.get(cur.parentId);
  }
  return depth;
}

/** Parents before children, as renderers like React Flow require. */
export function sortNodes(nodes: GraphNode[]): GraphNode[] {
  const depths = new Map(nodes.map((n) => [n.id, depthOf(nodes, n.id)]));
  return [...nodes].sort((a, b) => depths.get(a.id)! - depths.get(b.id)!);
}

export function absolutePosition(nodes: GraphNode[], id: string): Point {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let x = 0;
  let y = 0;
  let cur = byId.get(id);
  while (cur) {
    x += cur.position.x;
    y += cur.position.y;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return { x, y };
}

export function isDescendant(nodes: GraphNode[], id: string, ancestorId: string): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cur = byId.get(id);
  while (cur?.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = byId.get(cur.parentId);
  }
  return false;
}

export function vpcOf(nodes: GraphNode[], node: GraphNode): GraphNode | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cur: GraphNode | undefined = node;
  while (cur) {
    if (cur.type === 'vpc') return cur;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return undefined;
}

export function ancestorsOf(nodes: GraphNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  let cur = byId.get(id);
  while (cur?.parentId) {
    out.push(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return out;
}

function overlaps(a: GraphNode, b: GraphNode): boolean {
  return (
    a.position.x < b.position.x + b.size.width &&
    a.position.x + a.size.width > b.position.x &&
    a.position.y < b.position.y + b.size.height &&
    a.position.y + a.size.height > b.position.y
  );
}

/**
 * Push overlapping siblings apart by moving one of them down. Only pairs
 * where at least one side is a container are considered, so two loose
 * leaves may still be stacked by hand. The one in `keep` (the node being
 * edited, or its ancestors) stays put; otherwise a container stays over a
 * leaf, and between equals the upper one stays. Mutates the given nodes.
 */
function separate(group: GraphNode[], keep: Set<string>): void {
  const isContainer = (n: GraphNode) => RESOURCES[n.type].kind === 'container';
  for (let guard = 0; guard < 100; guard++) {
    let pair: [GraphNode, GraphNode] | undefined;
    for (let i = 0; i < group.length && !pair; i++) {
      for (let j = i + 1; j < group.length && !pair; j++) {
        const a = group[i];
        const b = group[j];
        if ((isContainer(a) || isContainer(b)) && overlaps(a, b)) pair = [a, b];
      }
    }
    if (!pair) return;
    const [a, b] = pair;
    const aStays = keep.has(a.id)
      ? true
      : keep.has(b.id)
        ? false
        : isContainer(a) !== isContainer(b)
          ? isContainer(a)
          : a.position.y < b.position.y || (a.position.y === b.position.y && a.position.x <= b.position.x);
    const [stay, move] = aStays ? [a, b] : [b, a];
    move.position.y = stay.position.y + stay.size.height + GAP;
  }
}

/**
 * Grow every container so it wraps its children, pushing sibling containers
 * apart when that growth makes them collide. Containers listed in `fit` are
 * also shrunk to the tightest size that still wraps them. `anchorId` is the
 * node being edited: it and its ancestors are never the ones pushed away.
 */
export function autoResize(
  nodes: GraphNode[],
  opts: { fit?: string[]; anchorId?: string } = {},
): GraphNode[] {
  const byId = new Map<string, GraphNode>(
    nodes.map((n) => [n.id, { ...n, position: { ...n.position }, size: { ...n.size } }]),
  );
  const fit = new Set(opts.fit ?? []);
  const keep = new Set(opts.anchorId ? [opts.anchorId, ...ancestorsOf(nodes, opts.anchorId)] : []);
  const isContainer = (n: GraphNode) => RESOURCES[n.type].kind === 'container';
  const containers = [...byId.values()]
    .filter(isContainer)
    .sort((a, b) => depthOf(nodes, b.id) - depthOf(nodes, a.id));

  for (const container of containers) {
    const min = RESOURCES[container.type].minSize;
    const kids = [...byId.values()].filter((n) => n.parentId === container.id);
    if (kids.length === 0) {
      if (fit.has(container.id)) container.size = { ...min };
      continue;
    }
    for (const kid of kids) {
      kid.position.x = Math.max(PAD, kid.position.x);
      kid.position.y = Math.max(PAD_TOP, kid.position.y);
    }
    separate(kids, keep);
    const reqW = Math.max(...kids.map((k) => k.position.x + k.size.width)) + PAD;
    const reqH = Math.max(...kids.map((k) => k.position.y + k.size.height)) + PAD;
    container.size = fit.has(container.id)
      ? { width: Math.max(min.width, reqW), height: Math.max(min.height, reqH) }
      : {
          width: Math.max(container.size.width, reqW, min.width),
          height: Math.max(container.size.height, reqH, min.height),
        };
  }
  separate(
    [...byId.values()].filter((n) => !n.parentId),
    keep,
  );
  return nodes.map((n) => byId.get(n.id)!);
}

/** Deepest container under `point` that `type` is allowed to live in. */
export function findContainerAt(
  nodes: GraphNode[],
  point: Point,
  type: ResourceType,
  excludeId?: string,
): GraphNode | undefined {
  const allowed = RESOURCES[type].parents;
  let best: GraphNode | undefined;
  let bestDepth = -1;
  for (const n of nodes) {
    if (!allowed.includes(n.type)) continue;
    if (excludeId && (n.id === excludeId || isDescendant(nodes, n.id, excludeId))) continue;
    const a = absolutePosition(nodes, n.id);
    const inside =
      point.x >= a.x &&
      point.x <= a.x + n.size.width &&
      point.y >= a.y &&
      point.y <= a.y + n.size.height;
    if (!inside) continue;
    const d = depthOf(nodes, n.id);
    if (d > bestDepth) {
      best = n;
      bestDepth = d;
    }
  }
  return best;
}

/** Re-parent a node while keeping its absolute position on the canvas. */
export function reparent(
  nodes: GraphNode[],
  id: string,
  parentId: string | undefined,
  absolute: Point,
): GraphNode[] {
  const base = parentId ? absolutePosition(nodes, parentId) : { x: 0, y: 0 };
  return nodes.map((n) =>
    n.id === id
      ? { ...n, parentId, position: { x: absolute.x - base.x, y: absolute.y - base.y } }
      : n,
  );
}

/** First spot inside `parentId` where a node of `size` doesn't touch a sibling. */
export function nextFreePosition(nodes: GraphNode[], parentId: string, size: Size): Point {
  const parent = nodes.find((n) => n.id === parentId);
  const siblings = nodes.filter((n) => n.parentId === parentId);
  if (!parent) return { x: PAD, y: PAD_TOP };
  const maxX = parent.size.width - PAD;
  const hits = (x: number, y: number) =>
    siblings.some(
      (s) =>
        x < s.position.x + s.size.width + GAP &&
        x + size.width + GAP > s.position.x &&
        y < s.position.y + s.size.height + GAP &&
        y + size.height + GAP > s.position.y,
    );
  const bottom = Math.max(PAD_TOP, ...siblings.map((s) => s.position.y + s.size.height + GAP));
  for (let y = PAD_TOP; y <= bottom; y += GAP) {
    for (let x = PAD; x + size.width <= maxX; x += GAP) {
      if (!hits(x, y)) return { x, y };
    }
  }
  return { x: PAD, y: bottom };
}

function defaultProps(type: ResourceType): Record<string, PropValue> {
  return Object.fromEntries(RESOURCES[type].fields.map((f) => [f.key, f.default]));
}

const NAME_PREFIX: Partial<Record<ResourceType, string>> = { route_table: 'rtb' };

function uniqueName(nodes: GraphNode[], type: ResourceType): string {
  const prefix = NAME_PREFIX[type] ?? type;
  const taken = new Set(nodes.map((n) => n.name));
  let i = nodes.filter((n) => n.type === type).length + 1;
  while (taken.has(`${prefix}-${i}`)) i++;
  return `${prefix}-${i}`;
}

export interface AddNodeOptions {
  parentId?: string;
  /** Relative to the parent when `parentId` is set. Omit to auto-place. */
  position?: Point;
  region: string;
}

export function addNode(
  nodes: GraphNode[],
  type: ResourceType,
  opts: AddNodeOptions,
): { nodes: GraphNode[]; node: GraphNode } {
  const def = RESOURCES[type];
  const id = newId();
  const props = defaultProps(type);
  const siblings = nodes.filter((n) => n.parentId === opts.parentId);

  if (type === 'subnet' && opts.parentId) {
    const vpc = nodes.find((n) => n.id === opts.parentId);
    const used = siblings.filter((n) => n.type === 'subnet').map((n) => String(n.props.cidr_block));
    props.cidr_block =
      nextSubnetCidr(String(vpc?.props.cidr_block ?? '10.0.0.0/16'), used) ?? '10.0.0.0/24';
    const azs = availabilityZones(opts.region);
    props.availability_zone = azs[used.length % azs.length];
  }
  if (type === 's3') props.bucket = `av2i-${id}`;

  const position =
    opts.position ??
    (opts.parentId
      ? nextFreePosition(nodes, opts.parentId, def.defaultSize)
      : { x: 60 + siblings.length * 40, y: 60 + siblings.length * 40 });

  const node: GraphNode = {
    id,
    type,
    name: uniqueName(nodes, type),
    position,
    size: { ...def.defaultSize },
    parentId: opts.parentId,
    props,
  };
  return { nodes: autoResize([...nodes, node], { anchorId: id }), node };
}

/** Remove a node, everything nested inside it, and every edge touching them. */
export function removeNode(graph: Graph, id: string): Graph {
  const doomed = new Set(
    graph.nodes.filter((n) => n.id === id || isDescendant(graph.nodes, n.id, id)).map((n) => n.id),
  );
  const parentId = graph.nodes.find((n) => n.id === id)?.parentId;
  const nodes = graph.nodes.filter((n) => !doomed.has(n.id)).map((n) => stripReferences(n, doomed));
  return {
    nodes: autoResize(nodes, { fit: parentId ? [parentId] : [] }),
    edges: graph.edges.filter((e) => !doomed.has(e.source) && !doomed.has(e.target)),
  };
}

import { nextSubnetCidr } from './cidr';
import { autoResize, isDescendant, newId } from './graph';
import type { Graph, GraphEdge, GraphNode, Point } from './types';

/** Selected nodes, everything nested inside them, and the edges between those nodes. */
export interface Fragment {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Ids (in `nodes`) of the outermost copied nodes. */
  rootIds: string[];
}

export function copySelection(graph: Graph, ids: string[]): Fragment {
  const wanted = new Set(ids);
  const rootIds = ids.filter(
    (id) => !graph.nodes.some((n) => wanted.has(n.id) && n.id !== id && isDescendant(graph.nodes, id, n.id)),
  );
  const nodes = graph.nodes.filter((n) => rootIds.some((r) => n.id === r || isDescendant(graph.nodes, n.id, r)));
  const inside = new Set(nodes.map((n) => n.id));
  return {
    nodes: nodes.map((n) => ({ ...n, position: { ...n.position }, size: { ...n.size }, props: { ...n.props } })),
    edges: graph.edges.filter((e) => inside.has(e.source) && inside.has(e.target)).map((e) => ({ ...e, props: e.props && { ...e.props } })),
    rootIds,
  };
}

function copyName(taken: Set<string>, name: string): string {
  const base = name.replace(/-copy(-\d+)?$/, '');
  let candidate = `${base}-copy`;
  for (let i = 2; taken.has(candidate); i++) candidate = `${base}-copy-${i}`;
  return candidate;
}

export interface PasteResult {
  graph: Graph;
  /** New ids of the pasted outermost nodes. */
  newIds: string[];
  /** Outermost nodes that couldn't be pasted because their container no longer exists. */
  skipped: number;
}

/**
 * Paste a fragment as new nodes. Outermost nodes land next to the originals (same container, shifted
 * by `offset`); subnets pasted into an existing VPC get the next free CIDR so they don't overlap,
 * and buckets get a fresh name.
 */
export function pasteFragment(graph: Graph, fragment: Fragment, offset: Point): PasteResult {
  const existing = new Set(graph.nodes.map((n) => n.id));
  const rootSet = new Set(fragment.rootIds);
  const skippedRoots = new Set(
    fragment.nodes.filter((n) => rootSet.has(n.id) && n.parentId && !existing.has(n.parentId)).map((n) => n.id),
  );
  const keep = fragment.nodes.filter(
    (n) => !skippedRoots.has(n.id) && ![...skippedRoots].some((r) => isDescendant(fragment.nodes, n.id, r)),
  );
  const idMap = new Map(keep.map((n) => [n.id, newId()]));
  const taken = new Set(graph.nodes.map((n) => n.name));

  const added: GraphNode[] = [];
  for (const n of keep) {
    const isRoot = rootSet.has(n.id);
    const id = idMap.get(n.id)!;
    const name = copyName(taken, n.name);
    taken.add(name);
    const props = { ...n.props };
    if (n.type === 's3') props.bucket = `av2i-${id}`;
    if (n.type === 'subnet' && isRoot && n.parentId) {
      const vpc = graph.nodes.find((x) => x.id === n.parentId);
      const used = [...graph.nodes, ...added]
        .filter((x) => x.type === 'subnet' && x.parentId === n.parentId)
        .map((x) => String(x.props.cidr_block));
      const next = nextSubnetCidr(String(vpc?.props.cidr_block ?? ''), used);
      if (next) props.cidr_block = next;
    }
    added.push({
      ...n,
      id,
      name,
      props,
      parentId: isRoot ? n.parentId : idMap.get(n.parentId!),
      position: isRoot ? { x: n.position.x + offset.x, y: n.position.y + offset.y } : n.position,
    });
  }
  const edges = fragment.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({ ...e, id: newId(), source: idMap.get(e.source)!, target: idMap.get(e.target)! }));

  const newIds = fragment.rootIds.filter((r) => idMap.has(r)).map((r) => idMap.get(r)!);
  const nodes = [...graph.nodes, ...added];
  return {
    graph: { nodes: autoResize(nodes, { anchorId: newIds[0] }), edges: [...graph.edges, ...edges] },
    newIds,
    skipped: skippedRoots.size,
  };
}

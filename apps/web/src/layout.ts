import { resolveEdges, RESOURCES, type Graph, type GraphNode } from '@av2i/core';
import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api';

const PAD_TOP = 56;
const PAD = 32;

/**
 * Arrange a graph so that nothing overlaps and connected resources sit next to each other: VPCs contain
 * their subnets contain their resources, and the flow of connections reads left to right.
 * Returns new positions (relative to the parent, as stored) and container sizes. ELK is loaded on first use.
 */
export async function autoLayout(graph: Graph): Promise<GraphNode[]> {
  const { nodes } = graph;
  if (nodes.length === 0) return nodes;
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ELK();

  const children = (parentId: string | undefined): ElkNode[] =>
    nodes
      .filter((n) => n.parentId === parentId)
      .map((n): ElkNode => {
        const container = RESOURCES[n.type].kind === 'container';
        return container
          ? {
              id: n.id,
              layoutOptions: {
                'elk.padding': `[top=${PAD_TOP},left=${PAD},bottom=${PAD},right=${PAD}]`,
                'elk.nodeLabels.placement': 'INSIDE V_TOP H_LEFT',
              },
              children: children(n.id),
            }
          : { id: n.id, width: n.size.width, height: n.size.height };
      });

  const edges: ElkExtendedEdge[] = resolveEdges(graph)
    .filter((r) => r.kind && !r.problem)
    .map((r) => ({ id: r.edge.id, sources: [r.edge.source], targets: [r.edge.target] }));

  const result = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '70',
      'elk.layered.spacing.nodeNodeBetweenLayers': '150',
      'elk.spacing.edgeNode': '40',
      'elk.spacing.edgeEdge': '24',
      'elk.layered.spacing.edgeNodeBetweenLayers': '40',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': '80',
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
    },
    children: children(undefined),
    edges,
  });

  const placed = new Map<string, ElkNode>();
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      placed.set(c.id, c);
      walk(c);
    }
  };
  walk(result);

  return nodes.map((n) => {
    const p = placed.get(n.id);
    if (!p || p.x === undefined || p.y === undefined) return n;
    const container = RESOURCES[n.type].kind === 'container';
    return {
      ...n,
      position: { x: Math.round(p.x), y: Math.round(p.y) },
      size: container ? { width: Math.ceil(p.width ?? n.size.width), height: Math.ceil(p.height ?? n.size.height) } : n.size,
    };
  });
}

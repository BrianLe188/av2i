import type { ResolvedEdge } from './edges';
import { vpcOf } from './graph';
import type { GraphNode } from './types';

/** Resource types that run inside a VPC and take security groups. */
export const HAS_SG = new Set(['ec2', 'lambda', 'ecs', 'rds', 'alb']);

/**
 * The explicit security groups each resource uses, by node id, in canvas order: the groups drawn and
 * connected to it, or else the VPC's default group. A resource missing from the map (or with an empty
 * list) gets a group of its own that av2i manages.
 */
export function sgAssignments(nodes: GraphNode[], resolved: ResolvedEdge[]): Map<string, GraphNode[]> {
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const out = new Map<string, GraphNode[]>();
  for (const r of resolved) {
    if (r.kind !== 'sg-attach' || r.problem || !r.from || !r.to) continue;
    const list = out.get(r.to.id) ?? [];
    if (!list.some((s) => s.id === r.from!.id)) list.push(r.from);
    out.set(r.to.id, list);
  }
  for (const list of out.values()) list.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  for (const n of nodes) {
    if (!HAS_SG.has(n.type) || out.has(n.id)) continue;
    const vpc = vpcOf(nodes, n);
    const fallback = vpc && nodes.find((s) => s.id === vpc.props.default_sg && s.type === 'sg' && vpcOf(nodes, s)?.id === vpc.id);
    if (fallback) out.set(n.id, [fallback]);
  }
  return out;
}

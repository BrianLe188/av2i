import { vpcOf } from './graph';
import { RESOURCES } from './resources';
import type { Graph, GraphEdge, GraphNode, ResourceType } from './types';

export type EdgeKind = 'route' | 'nat-route' | 'sg-attach' | 'cdn-origin' | 'dns-alias' | 'association' | 'db-access' | 'forward' | 's3-access';

export const DB_PORTS: Record<string, number> = { postgres: 5432, mysql: 3306, mariadb: 3306 };

interface Pair {
  kind: EdgeKind;
  /** Roles: `from` initiates / owns, `to` receives. Drawing direction doesn't matter. */
  from: ResourceType;
  to: ResourceType;
}

const PAIRS: Pair[] = [
  { kind: 'route', from: 'igw', to: 'route_table' },
  { kind: 'nat-route', from: 'nat', to: 'route_table' },
  { kind: 'sg-attach', from: 'sg', to: 'ec2' },
  { kind: 'sg-attach', from: 'sg', to: 'lambda' },
  { kind: 'sg-attach', from: 'sg', to: 'ecs' },
  { kind: 'sg-attach', from: 'sg', to: 'rds' },
  { kind: 'sg-attach', from: 'sg', to: 'alb' },
  { kind: 'cdn-origin', from: 'cdn', to: 's3' },
  { kind: 'cdn-origin', from: 'cdn', to: 'alb' },
  { kind: 'dns-alias', from: 'dns', to: 'alb' },
  { kind: 'dns-alias', from: 'dns', to: 'cdn' },
  { kind: 'association', from: 'route_table', to: 'subnet' },
  { kind: 'db-access', from: 'ec2', to: 'rds' },
  { kind: 'db-access', from: 'lambda', to: 'rds' },
  { kind: 'db-access', from: 'ecs', to: 'rds' },
  { kind: 'forward', from: 'alb', to: 'ec2' },
  { kind: 'forward', from: 'alb', to: 'ecs' },
  { kind: 's3-access', from: 'ec2', to: 's3' },
  { kind: 's3-access', from: 'lambda', to: 's3' },
];

export const EDGE_INFO: Record<EdgeKind, { title: string; generates: string }> = {
  route: {
    title: 'Default route to the internet',
    generates: 'A 0.0.0.0/0 route through the Internet Gateway in the Route Table.',
  },
  'nat-route': {
    title: 'Default route through NAT',
    generates:
      'An Elastic IP and NAT Gateway, and a 0.0.0.0/0 route through it in the Route Table (outbound-only internet for private subnets).',
  },
  'sg-attach': {
    title: 'Security group attachment',
    generates: 'Adds this security group (and its rules) to the resource, next to the one av2i manages for it.',
  },
  'cdn-origin': {
    title: 'CloudFront origin',
    generates:
      'Makes the bucket (read through an origin access control and a bucket policy) or the load balancer the origin of the distribution.',
  },
  'dns-alias': {
    title: 'DNS alias',
    generates: 'A Route 53 A (alias) record pointing the record name at the load balancer or CloudFront distribution.',
  },
  association: {
    title: 'Route table association',
    generates: 'Associates the Subnet with the Route Table.',
  },
  'db-access': {
    title: 'Database access',
    generates:
      'A security group rule on the database allowing its port from the instance\'s or function\'s security group.',
  },
  forward: {
    title: 'Load balancer target',
    generates:
      'A target group, target attachment (or ECS service registration) and listener, plus a rule letting the load balancer reach the instance on the target port.',
  },
  's3-access': {
    title: 'S3 access',
    generates:
      'A least-privilege IAM policy (plus an instance profile for EC2) so the instance or function can use the bucket.',
  },
};

export interface ResolvedEdge {
  edge: GraphEdge;
  /** Null when the connection means nothing (see `problem`). */
  kind: EdgeKind | null;
  from?: GraphNode;
  to?: GraphNode;
  label: string;
  problem?: string;
}

/** The port a load balancer sends traffic to: the container's own port for ECS, else the ALB's target port. */
export function forwardPort(alb: GraphNode, target: GraphNode): number {
  return Number(target.type === 'ecs' ? target.props.container_port : alb.props.target_port) || 80;
}

export const S3_ACCESS_LEVELS = ['read', 'readwrite'];

export function defaultEdgeProps(kind: EdgeKind | null): Record<string, string> | undefined {
  return kind === 's3-access' ? { access: 'read' } : undefined;
}

function supported(): string {
  return PAIRS.map((p) => `${RESOURCES[p.from].label} ↔ ${RESOURCES[p.to].label}`).join(', ');
}

export function classifyEdge(nodes: GraphNode[], edge: GraphEdge): ResolvedEdge {
  const s = nodes.find((n) => n.id === edge.source);
  const t = nodes.find((n) => n.id === edge.target);
  if (!s || !t) return { edge, kind: null, label: '', problem: 'Connection points at a missing resource.' };

  const pair = PAIRS.find(
    (p) => (s.type === p.from && t.type === p.to) || (s.type === p.to && t.type === p.from),
  );
  if (!pair) {
    return {
      edge,
      kind: null,
      label: '?',
      problem: `${RESOURCES[s.type].label} ↔ ${RESOURCES[t.type].label} has no meaning yet. Supported: ${supported()}.`,
    };
  }
  const [from, to] = s.type === pair.from ? [s, t] : [t, s];
  const vFrom = vpcOf(nodes, from);
  const vTo = vpcOf(nodes, to);
  const base = { edge, kind: pair.kind, from, to };

  let label = '';
  switch (pair.kind) {
    case 'route':
      label = '0.0.0.0/0';
      break;
    case 'nat-route':
      label = '0.0.0.0/0 via NAT';
      break;
    case 'sg-attach':
      label = 'attached';
      break;
    case 'cdn-origin':
      label = 'origin';
      break;
    case 'dns-alias':
      label = 'alias';
      break;
    case 'association':
      label = 'associated';
      break;
    case 'db-access':
      label = `:${DB_PORTS[String(to.props.engine)] ?? '?'}`;
      break;
    case 'forward':
      label = `:${from.props.listener_port} → :${forwardPort(from, to)}`;
      break;
    case 's3-access':
      label = edge.props?.access === 'readwrite' ? 'read/write' : 'read';
      break;
  }
  // S3 buckets, DNS records and CloudFront live outside any VPC, so only the other kinds need a shared VPC.
  if (pair.kind !== 's3-access' && pair.kind !== 'dns-alias' && pair.kind !== 'cdn-origin' && (!vFrom || !vTo || vFrom.id !== vTo.id)) {
    return {
      ...base,
      label,
      problem: `${RESOURCES[from.type].label} and ${RESOURCES[to.type].label} must be in the same VPC.`,
    };
  }
  return { ...base, label };
}

export function resolveEdges(graph: Graph): ResolvedEdge[] {
  return graph.edges.map((e) => classifyEdge(graph.nodes, e));
}

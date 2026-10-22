import { cidrContains, cidrOverlaps, parseCidr } from './cidr';
import { resolveEdges } from './edges';
import { vpcOf } from './graph';
import { RESOURCES } from './resources';
import type { Graph, Issue } from './types';

export function validateGraph(graph: Graph): Issue[] {
  const issues: Issue[] = [];
  const { nodes } = graph;
  const error = (nodeId: string, message: string) =>
    issues.push({ nodeId, severity: 'error', message });
  const warn = (nodeId: string, message: string) =>
    issues.push({ nodeId, severity: 'warning', message });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    const def = RESOURCES[node.type];
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (def.parents.length > 0 && (!parent || !def.parents.includes(parent.type))) {
      error(node.id, `${def.label} must be placed inside a ${def.parents.join(' / ')}.`);
    }
  }

  for (const vpc of nodes.filter((n) => n.type === 'vpc')) {
    const vpcCidr = parseCidr(String(vpc.props.cidr_block));
    if (!vpcCidr) error(vpc.id, `Invalid CIDR "${vpc.props.cidr_block}".`);

    const subnets = nodes.filter((n) => n.type === 'subnet' && n.parentId === vpc.id);
    const parsed = subnets.map((s) => ({ node: s, cidr: parseCidr(String(s.props.cidr_block)) }));

    for (const { node, cidr } of parsed) {
      if (!cidr) {
        error(node.id, `Invalid CIDR "${node.props.cidr_block}".`);
        continue;
      }
      if (vpcCidr && !cidrContains(vpcCidr, cidr)) {
        error(node.id, `CIDR ${node.props.cidr_block} is outside the VPC range ${vpc.props.cidr_block}.`);
      }
      if (!String(node.props.availability_zone).trim()) {
        error(node.id, 'Availability zone is required.');
      }
    }
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const a = parsed[i];
        const b = parsed[j];
        if (a.cidr && b.cidr && cidrOverlaps(a.cidr, b.cidr)) {
          error(b.node.id, `CIDR overlaps with subnet "${a.node.name}".`);
        }
      }
    }

    const hasRds = nodes.some((n) => n.type === 'rds' && vpcOf(nodes, n)?.id === vpc.id);
    if (hasRds) {
      const azs = new Set(subnets.map((s) => String(s.props.availability_zone)).filter(Boolean));
      if (azs.size < 2) {
        for (const db of nodes.filter((n) => n.type === 'rds' && vpcOf(nodes, n)?.id === vpc.id)) {
          error(db.id, 'RDS needs subnets in at least 2 availability zones within the VPC.');
        }
      }
    }
  }

  for (const node of nodes) {
    if (node.type === 's3') {
      const name = String(node.props.bucket);
      if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)) {
        error(node.id, 'Bucket name must be 3-63 chars: lowercase letters, digits, "." or "-".');
      }
    }
    if (node.type === 'rds' && !node.props.multi_az) {
      warn(node.id, 'Multi-AZ is off: no automatic failover.');
    }
    if (node.type === 'ec2' && Number(node.props.root_volume_size) < 8) {
      warn(node.id, 'Root volume under 8 GiB may not fit the AMI.');
    }
  }

  validateConnections(graph, issues);
  return issues;
}

function validateConnections(graph: Graph, issues: Issue[]): void {
  const { nodes } = graph;
  const resolved = resolveEdges(graph);
  const add = (nodeId: string, severity: Issue['severity'], message: string, edgeId?: string) =>
    issues.push({ nodeId, edgeId, severity, message });

  for (const r of resolved) {
    if (r.problem) add(r.edge.source, 'error', r.problem, r.edge.id);
  }
  const ok = resolved.filter((r) => r.kind && !r.problem);
  const of = (kind: string) => ok.filter((r) => r.kind === kind);

  const igwsByVpc = new Map<string, string[]>();
  for (const igw of nodes.filter((n) => n.type === 'igw')) {
    const vpc = vpcOf(nodes, igw);
    if (vpc) igwsByVpc.set(vpc.id, [...(igwsByVpc.get(vpc.id) ?? []), igw.id]);
    if (!of('route').some((r) => r.from!.id === igw.id)) {
      add(igw.id, 'warning', 'Not connected to a Route Table, so it routes no traffic.');
    }
  }
  for (const ids of igwsByVpc.values()) {
    for (const id of ids.slice(1)) add(id, 'error', 'A VPC can have only one Internet Gateway.');
  }

  for (const nat of nodes.filter((n) => n.type === 'nat')) {
    const subnet = nodes.find((n) => n.id === nat.parentId);
    const routedToIgw =
      subnet &&
      of('association').some(
        (r) => r.to!.id === subnet.id && of('route').some((x) => x.to!.id === r.from!.id),
      );
    if (!routedToIgw) {
      add(nat.id, 'warning', 'A NAT Gateway needs a public subnet with a route to an Internet Gateway.');
    }
    if (!of('nat-route').some((r) => r.from!.id === nat.id)) {
      add(nat.id, 'warning', 'Not connected to a Route Table, so no subnet uses it.');
    }
  }

  for (const rt of nodes.filter((n) => n.type === 'route_table')) {
    if (!of('association').some((r) => r.from!.id === rt.id)) {
      add(rt.id, 'warning', 'Not associated with any subnet.');
    }
    const defaultRoutes = [...of('route'), ...of('nat-route')].filter((r) => r.to!.id === rt.id);
    if (defaultRoutes.length > 1) {
      add(rt.id, 'error', 'Connected to more than one gateway (Internet or NAT): duplicate default route.');
    }
  }

  for (const subnet of nodes.filter((n) => n.type === 'subnet' && n.props.public)) {
    const routed = of('association').some(
      (r) => r.to!.id === subnet.id && of('route').some((x) => x.to!.id === r.from!.id),
    );
    if (!routed) {
      add(
        subnet.id,
        'warning',
        'Public subnet has no route to an Internet Gateway: connect it to a Route Table that has one.',
      );
    }
  }

  for (const alb of nodes.filter((n) => n.type === 'alb')) {
    const vpc = vpcOf(nodes, alb);
    if (vpc) {
      const pool = nodes.filter(
        (n) => n.type === 'subnet' && n.parentId === vpc.id && (alb.props.internal || n.props.public),
      );
      const azs = new Set(pool.map((s) => String(s.props.availability_zone)).filter(Boolean));
      if (azs.size < 2) {
        add(
          alb.id,
          'error',
          alb.props.internal
            ? 'A load balancer needs subnets in at least 2 availability zones.'
            : 'An internet-facing load balancer needs public subnets in at least 2 availability zones.',
        );
      }
    }
    if (!of('forward').some((r) => r.from!.id === alb.id)) {
      add(alb.id, 'warning', 'No targets: connect it to an EC2 instance.');
    }
  }
}

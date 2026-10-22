import { cidrContains, cidrOverlaps, parseCidr } from './cidr';
import { resolveEdges } from './edges';
import { vpcOf } from './graph';
import { HAS_SG, sgAssignments } from './sg';
import { expandRule, sgIdOfPeer, sgRules } from './sg-rules';
import { securityChecks } from './security';
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
  issues.push(...securityChecks(graph));
  return issues;
}

function validateConnections(graph: Graph, issues: Issue[]): void {
  const { nodes } = graph;
  const byId = new Map(nodes.map((n) => [n.id, n]));
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

  const assigned = sgAssignments(nodes, ok);
  const isDefault = new Set(nodes.filter((n) => n.type === 'vpc').map((v) => String(v.props.default_sg ?? '')));
  for (const sg of nodes.filter((n) => n.type === 'sg')) {
    const vpc = vpcOf(nodes, sg);
    for (const dir of ['ingress', 'egress'] as const) {
      sgRules(sg, dir).forEach((r, i) => {
        const where = `${dir === 'ingress' ? 'Inbound' : 'Outbound'} rule ${i + 1}`;
        if (!expandRule(r)) add(sg.id, 'error', `${where}: ports must look like 22, 443, 8000-8100 (1 to 65535).`);
        const peerId = sgIdOfPeer(r.peer);
        if (peerId !== undefined) {
          const peer = byId.get(peerId);
          if (peer?.type !== 'sg') add(sg.id, 'error', `${where}: the security group it refers to no longer exists.`);
          else if (vpcOf(nodes, peer)?.id !== vpc?.id) add(sg.id, 'error', `${where}: "${peer.name}" is in another VPC.`);
        } else if (!r.peer.trim()) {
          add(sg.id, 'error', `${where}: the ${dir === 'ingress' ? 'source' : 'destination'} is empty.`);
        } else if (!parseCidr(r.peer)) {
          add(sg.id, 'error', `${where}: invalid CIDR "${r.peer}".`);
        }
      });
    }
    if (!of('sg-attach').some((r) => r.from!.id === sg.id) && !isDefault.has(sg.id)) {
      add(sg.id, 'warning', 'Not attached to anything: connect it to an EC2 instance, function, database or load balancer, or make it a VPC default.');
    }
  }
  for (const vpc of nodes.filter((n) => n.type === 'vpc' && String(n.props.default_sg ?? ''))) {
    const sg = byId.get(String(vpc.props.default_sg));
    if (sg?.type !== 'sg' || vpcOf(nodes, sg)?.id !== vpc.id) add(vpc.id, 'error', 'The default security group must be a security group inside this VPC.');
  }
  for (const n of nodes.filter((x) => HAS_SG.has(x.type))) {
    const groups = assigned.get(n.id) ?? [];
    if (groups.length > 5) add(n.id, 'error', 'AWS allows at most 5 security groups on one resource.');
  }
  // A load balancer with its own security groups is only reachable if those groups let the listener in.
  for (const alb of nodes.filter((n) => n.type === 'alb')) {
    const groups = assigned.get(alb.id) ?? [];
    if (groups.length === 0) continue;
    const opens = (port: number) =>
      groups.some((g) =>
        sgRules(g, 'ingress').some((r) =>
          expandRule(r)?.some((seg) => seg.from === undefined || (seg.protocol === 'tcp' && seg.from <= port && port <= seg.to!)),
        ),
      );
    const port = Number(alb.props.listener_port) || 80;
    if (!opens(port)) add(alb.id, 'warning', `Its security groups allow no inbound traffic on the listener port ${port}, so nothing can reach it.`);
  }

  /** True when `subnetId` is associated with a route table that has a NAT default route. */
  const natRouted = (subnetId: string | undefined) =>
    of('association').some(
      (r) => r.to!.id === subnetId && of('nat-route').some((x) => x.to!.id === r.from!.id),
    );

  const FARGATE_MEMORY: Record<number, number[]> = {
    256: [512, 1024, 2048],
    512: [1024, 2048, 3072, 4096],
    1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
    2048: [4096, 5120, 6144, 7168, 8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384],
  };
  for (const svc of nodes.filter((n) => n.type === 'ecs')) {
    const port = Number(svc.props.container_port);
    const count = Number(svc.props.desired_count);
    const cpu = Number(svc.props.cpu);
    const memory = Number(svc.props.memory);
    if (!String(svc.props.image).trim()) add(svc.id, 'error', 'Container image is required.');
    if (!(Number.isInteger(port) && port >= 1 && port <= 65535)) add(svc.id, 'error', 'Container port must be 1-65535.');
    if (!(Number.isInteger(count) && count >= 0 && count <= 100)) add(svc.id, 'error', 'Tasks must be a whole number from 0 to 100.');
    if (!FARGATE_MEMORY[cpu]?.includes(memory)) {
      add(svc.id, 'error', `Fargate does not offer ${memory} MB with ${cpu} CPU units. Valid: ${FARGATE_MEMORY[cpu]?.join(', ')} MB.`);
    }
    const subnet = nodes.find((n) => n.id === svc.parentId);
    if (subnet && !subnet.props.public && !natRouted(subnet.id)) {
      add(
        svc.id,
        'warning',
        'Tasks in a private subnet need a NAT Gateway route to pull their image (or place the service in a public subnet).',
      );
    }
  }

  for (const fn of nodes.filter((n) => n.type === 'lambda')) {
    const timeout = Number(fn.props.timeout);
    const memory = Number(fn.props.memory_size);
    if (!(timeout >= 1 && timeout <= 900)) add(fn.id, 'error', 'Timeout must be between 1 and 900 seconds.');
    if (!(memory >= 128 && memory <= 10240)) add(fn.id, 'error', 'Memory must be between 128 and 10240 MB.');
    if (!/^[\w-]+(\.[\w-]+)+$/.test(String(fn.props.handler).trim())) {
      add(fn.id, 'error', 'Handler must look like file.function, for example index.handler.');
    }
    // A function in a VPC has no public IP, so reaching S3 needs a NAT route (or a VPC endpoint, not modelled yet).
    const usesS3 = of('s3-access').some((r) => r.from!.id === fn.id);
    if (usesS3 && !natRouted(fn.parentId)) {
      add(
        fn.id,
        'warning',
        'A function in a VPC reaches S3 only through a NAT Gateway: connect its subnet to a Route Table that routes through one.',
      );
    }
  }

  for (const cdn of nodes.filter((n) => n.type === 'cdn')) {
    const origins = of('cdn-origin').filter((r) => r.from!.id === cdn.id);
    if (origins.length === 0) add(cdn.id, 'warning', 'No origin: connect it to an S3 bucket or a load balancer.');
    if (origins.length > 1) add(cdn.id, 'error', 'A distribution has one origin here: remove the extra connections.');
    const cert = String(cdn.props.certificate_arn).trim();
    const aliases = String(cdn.props.aliases).split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
    if (cert && !/^arn:aws[a-z-]*:acm:us-east-1:\d{12}:certificate\/[\w-]+$/.test(cert)) {
      add(cdn.id, 'error', 'CloudFront needs an ACM certificate ARN from us-east-1: arn:aws:acm:us-east-1:<account>:certificate/<id>.');
    }
    if (aliases.length && !cert) add(cdn.id, 'error', 'Domain aliases need an ACM certificate.');
    for (const a of aliases) {
      if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(a)) add(cdn.id, 'error', `"${a}" is not a valid domain name.`);
    }
    const alb = origins.find((r) => r.to!.type === 'alb')?.to;
    if (alb && String(alb.props.certificate_arn ?? '').trim()) {
      add(cdn.id, 'warning', 'The load balancer speaks HTTPS to CloudFront: its certificate must cover the load balancer\'s own DNS name, or CloudFront will reject it.');
    }
    for (const r of of('dns-alias').filter((x) => x.to!.id === cdn.id)) {
      const record = String(r.from!.props.record_name).trim().toLowerCase();
      if (!aliases.includes(record)) {
        add(r.from!.id, 'warning', `Add ${record} to the CloudFront domain aliases, or CloudFront will refuse requests for it.`);
      }
    }
  }

  for (const dns of nodes.filter((n) => n.type === 'dns')) {
    const zone = String(dns.props.zone_name).trim().toLowerCase();
    const record = String(dns.props.record_name).trim().toLowerCase();
    const host = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
    if (!host.test(zone)) add(dns.id, 'error', `"${dns.props.zone_name}" is not a valid domain name.`);
    if (!host.test(record)) add(dns.id, 'error', `"${dns.props.record_name}" is not a valid host name.`);
    else if (host.test(zone) && record !== zone && !record.endsWith(`.${zone}`)) {
      add(dns.id, 'error', `Record name must be ${zone} or end with .${zone}.`);
    }
    const aliases = of('dns-alias').filter((r) => r.from!.id === dns.id);
    if (aliases.length === 0) add(dns.id, 'warning', 'Not connected to a load balancer or CloudFront distribution, so it creates no record.');
    if (aliases.length > 1) add(dns.id, 'error', 'A DNS record can point to only one target.');
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
    const arn = String(alb.props.certificate_arn ?? '').trim();
    if (arn && !/^arn:aws[a-z-]*:acm:[a-z0-9-]+:\d{12}:certificate\/[\w-]+$/.test(arn)) {
      add(alb.id, 'error', 'Certificate must be an ACM ARN: arn:aws:acm:<region>:<account>:certificate/<id>.');
    }
    const targets = of('forward').filter((r) => r.from!.id === alb.id);
    if (targets.some((r) => r.to!.type === 'ecs') && targets.some((r) => r.to!.type !== 'ecs')) {
      add(alb.id, 'error', 'A load balancer can send to EC2 instances or to ECS services, not both.');
    }
    if (new Set(targets.filter((r) => r.to!.type === 'ecs').map((r) => Number(r.to!.props.container_port))).size > 1) {
      add(alb.id, 'error', 'ECS services behind one load balancer must use the same container port.');
    }
    if (targets.length === 0) {
      add(alb.id, 'warning', 'No targets: connect it to an EC2 instance or an ECS service.');
    }
  }
}

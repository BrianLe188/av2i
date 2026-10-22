import { describe, expect, it } from 'vitest';
import {
  addNode,
  autoResize,
  classifyEdge,
  findContainerAt,
  generateTerraform,
  nextSubnetCidr,
  parseCidr,
  removeNode,
  reparent,
  TEMPLATES,
  validateGraph,
  type GraphNode,
} from '../src';
import { build, edge, region, scenario } from './fixtures';

describe('cidr', () => {
  it('parses and rejects', () => {
    expect(parseCidr('10.0.0.0/16')).not.toBeNull();
    expect(parseCidr('10.0.0.0/33')).toBeNull();
    expect(parseCidr('nope')).toBeNull();
  });
  it('picks the next free /24', () => {
    expect(nextSubnetCidr('10.0.0.0/16', [])).toBe('10.0.0.0/24');
    expect(nextSubnetCidr('10.0.0.0/16', ['10.0.0.0/24', '10.0.1.0/24'])).toBe('10.0.2.0/24');
    expect(nextSubnetCidr('10.0.0.0/24', ['10.0.0.0/24'])).toBeNull();
  });
});

describe('nesting + auto-resize', () => {
  it('assigns distinct cidr and az to sibling subnets', () => {
    const { s1, s2 } = build();
    expect(s1.props.cidr_block).not.toBe(s2.props.cidr_block);
    expect(s1.props.availability_zone).not.toBe(s2.props.availability_zone);
  });

  it('grows the vpc to wrap children and never overlaps siblings', () => {
    const { nodes, vpc, s1, s2 } = build();
    const v = nodes.find((n) => n.id === vpc.id)!;
    for (const s of [s1, s2]) {
      const c = nodes.find((n) => n.id === s.id)!;
      expect(c.position.x + c.size.width).toBeLessThanOrEqual(v.size.width);
      expect(c.position.y + c.size.height).toBeLessThanOrEqual(v.size.height);
    }
    const a = nodes.find((n) => n.id === s1.id)!;
    const b = nodes.find((n) => n.id === s2.id)!;
    const apart =
      a.position.x + a.size.width <= b.position.x ||
      b.position.x + b.size.width <= a.position.x ||
      a.position.y + a.size.height <= b.position.y ||
      b.position.y + b.size.height <= a.position.y;
    expect(apart).toBe(true);
  });

  it('propagates growth up through nested containers', () => {
    const { nodes, s1 } = build();
    const db = addNode(nodes, 'ec2', {
      region,
      parentId: s1.id,
      position: { x: 400, y: 200 },
    });
    const sub = db.nodes.find((n) => n.id === s1.id)!;
    const vpc = db.nodes.find((n) => n.id === s1.parentId)!;
    expect(sub.size.width).toBeGreaterThanOrEqual(400 + 140 + 20);
    expect(vpc.size.width).toBeGreaterThanOrEqual(sub.position.x + sub.size.width + 20);
  });

  it('pushes sibling subnets apart when one grows over the other', () => {
    const { nodes, s1, s2 } = build();
    // A wide child forces s1 to grow; s2 must be pushed clear of it and the vpc must wrap both.
    const grown = addNode(nodes, 'ec2', { region, parentId: s1.id, position: { x: 20, y: 150 } });
    const a = grown.nodes.find((n) => n.id === s1.id)!;
    const b = grown.nodes.find((n) => n.id === s2.id)!;
    const v = grown.nodes.find((n) => n.id === a.parentId)!;
    expect(b.position.y).toBeGreaterThanOrEqual(a.position.y + a.size.height);
    expect(b.position.y + b.size.height + 20).toBeLessThanOrEqual(v.size.height);
  });

  it('shrinks only containers listed in fit', () => {
    const { nodes, vpc, s2 } = build();
    const grown = autoResize(nodes);
    const without = removeNode({ nodes: grown, edges: [] }, s2.id);
    const before = grown.find((n) => n.id === vpc.id)!.size;
    const after = without.nodes.find((n) => n.id === vpc.id)!.size;
    expect(after.height).toBeLessThanOrEqual(before.height);
  });

  it('finds the deepest valid container and rejects invalid ones', () => {
    const { nodes, s1 } = build();
    const s = nodes.find((n) => n.id === s1.id)!;
    const found = findContainerAt(nodes, { x: s.position.x + 30, y: s.position.y + 60 }, 'ec2');
    expect(found?.id).toBe(s1.id);
    expect(findContainerAt(nodes, { x: 5000, y: 5000 }, 'ec2')).toBeUndefined();
    expect(findContainerAt(nodes, { x: 30, y: 60 }, 'ec2')?.type).toBe('subnet');
  });

  it('reparent keeps absolute position', () => {
    const { nodes, s1, s2 } = build();
    const ec2 = addNode(nodes, 'ec2', { region, parentId: s1.id });
    const abs = { x: 123, y: 321 };
    const moved = reparent(ec2.nodes, ec2.node.id, s2.id, abs);
    const m = moved.find((n) => n.id === ec2.node.id)!;
    const p = moved.find((n) => n.id === s2.id)!;
    const v = moved.find((n) => n.id === p.parentId)!;
    expect(m.position.x + p.position.x + v.position.x).toBe(abs.x);
    expect(m.position.y + p.position.y + v.position.y).toBe(abs.y);
  });
});

describe('validation', () => {
  it('flags subnet cidr outside the vpc and overlaps', () => {
    const { nodes, s1, s2 } = build();
    const bad = nodes.map((n) =>
      n.id === s1.id
        ? { ...n, props: { ...n.props, cidr_block: '192.168.0.0/24' } }
        : n.id === s2.id
          ? { ...n, props: { ...n.props, cidr_block: '10.0.5.0/24' } }
          : n,
    );
    const issues = validateGraph({ nodes: bad, edges: [] });
    expect(issues.some((i) => i.nodeId === s1.id && /outside/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.nodeId === s2.id)).toBe(false);
  });

  it('requires 2 azs for rds', () => {
    const { nodes, s1 } = build();
    const one = nodes.filter((n) => n.type !== 'subnet' || n.id === s1.id);
    const withDb = addNode(one, 'rds', { region, parentId: s1.id });
    const issues = validateGraph({ nodes: withDb.nodes, edges: [] });
    expect(issues.some((i) => i.nodeId === withDb.node.id && i.severity === 'error')).toBe(true);
  });
});

describe('edges', () => {
  it('classifies pairs regardless of drawing direction', () => {
    const k = scenario();
    for (const [a, b, kind] of [
      [k.igw, k.rt, 'route'],
      [k.rt, k.s1, 'association'],
      [k.ec2, k.rds, 'db-access'],
      [k.alb, k.ec2, 'forward'],
      [k.ec2, k.bucket, 's3-access'],
    ] as const) {
      expect(classifyEdge(k.nodes, edge(a.id, b.id)).kind).toBe(kind);
      const rev = classifyEdge(k.nodes, edge(b.id, a.id));
      expect(rev.kind).toBe(kind);
      expect(rev.from!.id).toBe(a.id);
    }
  });

  it('rejects meaningless and cross-vpc connections', () => {
    const k = scenario();
    expect(classifyEdge(k.nodes, edge(k.ec2.id, k.alb.id)).kind).toBe('forward');
    expect(classifyEdge(k.nodes, edge(k.rds.id, k.bucket.id)).problem).toMatch(/no meaning/);
    const other = addNode(k.nodes, 'vpc', { region, position: { x: 900, y: 0 } });
    const sub = addNode(other.nodes, 'subnet', { region, parentId: other.node.id });
    const far = addNode(sub.nodes, 'ec2', { region, parentId: sub.node.id });
    expect(classifyEdge(far.nodes, edge(far.node.id, k.rds.id)).problem).toMatch(/same VPC/);
    // S3 is outside any VPC, so it never trips the same-VPC rule
    expect(classifyEdge(far.nodes, edge(far.node.id, k.bucket.id)).problem).toBeUndefined();
  });
});

describe('terraform', () => {
  it('generates a plausible module from nodes and edges', () => {
    const k = scenario();
    const edges = [
      edge(k.igw.id, k.rt.id),
      edge(k.rt.id, k.s1.id),
      edge(k.ec2.id, k.rds.id),
      edge(k.alb.id, k.ec2.id),
      edge(k.ec2.id, k.bucket.id, { access: 'readwrite' }),
    ];
    const files = generateTerraform({ nodes: k.nodes, edges }, { region });
    const main = files['main.tf'];
    for (const needle of [
      'resource "aws_vpc"',
      'resource "aws_subnet"',
      'resource "aws_internet_gateway"',
      'resource "aws_route_table" "rtb_1"',
      'gateway_id = aws_internet_gateway.igw_1.id',
      'resource "aws_route_table_association"',
      'resource "aws_security_group" "ec2_1"',
      'resource "aws_vpc_security_group_ingress_rule" "rds_1_from_ec2_1"',
      'resource "aws_vpc_security_group_ingress_rule" "ec2_1_from_alb_1"',
      'resource "aws_lb" "alb_1"',
      'resource "aws_lb_target_group_attachment" "alb_1_ec2_1"',
      'resource "aws_lb_listener" "alb_1"',
      'resource "aws_iam_role" "ec2_1"',
      '"s3:PutObject"',
      'iam_instance_profile',
      'resource "aws_instance"',
      'resource "aws_db_instance"',
      'resource "aws_s3_bucket"',
    ]) {
      expect(main).toContain(needle);
    }
    expect(main).toMatch(/from_port\s+= 5432/);
    // read/write bucket must not also get a read-only statement
    expect(main.match(/s3:GetObject/g)?.length).toBe(1);
    // the load balancer sits in the public subnets only
    expect(main).toMatch(/subnets\s+= \[aws_subnet\.subnet_1\.id, aws_subnet\.subnet_2\.id\]/);
    expect(files['providers.tf']).toContain('region = "us-east-1"');
  });

  it('emits nothing for edges without meaning and dedupes duplicates', () => {
    const k = scenario();
    const dup = [edge(k.ec2.id, k.rds.id), { ...edge(k.rds.id, k.ec2.id), id: 'dup' }, edge(k.rds.id, k.bucket.id)];
    const main = generateTerraform({ nodes: k.nodes, edges: dup }, { region })['main.tf'];
    expect(main.match(/"rds_1_from_ec2_1"/g)?.length).toBe(1);
    expect(main).not.toContain('aws_iam_role');
  });

  it('uses no iam or listener resources when nothing is connected', () => {
    const k = scenario();
    const main = generateTerraform({ nodes: k.nodes, edges: [] }, { region })['main.tf'];
    expect(main).not.toContain('aws_iam');
    expect(main).not.toContain('aws_lb_listener');
    expect(main).not.toContain('aws_vpc_security_group_ingress_rule" "rds');
  });
});

describe('connection validation', () => {
  it('warns about unwired network pieces and flags bad edges', () => {
    const k = scenario();
    const issues = validateGraph({ nodes: k.nodes, edges: [edge(k.rds.id, k.bucket.id)] });
    const msgs = issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/Not connected to a Route Table/);
    expect(msgs).toMatch(/Not associated with any subnet/);
    expect(msgs).toMatch(/Public subnet has no route/);
    expect(msgs).toMatch(/No targets/);
    expect(issues.some((i) => i.severity === 'error' && i.edgeId)).toBe(true);
  });

  it('is clean once the public path is wired', () => {
    const k = scenario();
    const edges = [
      edge(k.igw.id, k.rt.id),
      edge(k.rt.id, k.s1.id),
      edge(k.rt.id, k.s2.id),
      edge(k.alb.id, k.ec2.id),
    ];
    const issues = validateGraph({ nodes: k.nodes, edges });
    expect(issues.filter((i) => /route|Route|No targets|associated|facing/.test(i.message))).toEqual([]);
  });

  it('requires two public azs for an internet-facing alb and one igw per vpc', () => {
    const k = scenario();
    const oneAz = k.nodes.map((n) => (n.id === k.s2.id ? { ...n, props: { ...n.props, public: false } } : n));
    const extraIgw = addNode(oneAz, 'igw', { region, parentId: k.vpc.id });
    const issues = validateGraph({ nodes: extraIgw.nodes, edges: [] });
    expect(issues.some((i) => i.nodeId === k.alb.id && /2 availability zones/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.nodeId === extraIgw.node.id && /only one Internet Gateway/.test(i.message))).toBe(true);
  });
});

describe('nat gateway', () => {
  /** Public subnet s1 holds a NAT; private subnet routes out through it. */
  function withNat() {
    const k = scenario();
    const r = addNode(k.nodes, 'nat', { region, parentId: k.s1.id });
    const rt2 = addNode(r.nodes, 'route_table', { region, parentId: k.vpc.id });
    const nodes = rt2.nodes;
    const edges = [
      edge(k.igw.id, k.rt.id),
      edge(k.rt.id, k.s1.id),
      edge(r.node.id, rt2.node.id),
      edge(rt2.node.id, k.priv.id),
    ];
    return { ...k, nodes, nat: r.node, rt2: rt2.node, edges };
  }

  it('classifies NAT ↔ route table in either direction', () => {
    const k = withNat();
    expect(classifyEdge(k.nodes, edge(k.nat.id, k.rt2.id)).kind).toBe('nat-route');
    expect(classifyEdge(k.nodes, edge(k.rt2.id, k.nat.id)).from!.id).toBe(k.nat.id);
  });

  it('generates an EIP, NAT gateway and a nat_gateway_id route', () => {
    const k = withNat();
    const main = generateTerraform({ nodes: k.nodes, edges: k.edges }, { region })['main.tf'];
    expect(main).toContain('resource "aws_eip"');
    expect(main).toContain('resource "aws_nat_gateway"');
    expect(main).toMatch(/depends_on = \[aws_internet_gateway\./);
    expect(main).toMatch(/nat_gateway_id = aws_nat_gateway\./);
  });

  it('is clean when set up properly and warns when not', () => {
    const k = withNat();
    const issues = validateGraph({ nodes: k.nodes, edges: k.edges }).filter((i) => i.nodeId === k.nat.id);
    expect(issues).toEqual([]);
    const loose = validateGraph({ nodes: k.nodes, edges: [] }).filter((i) => i.nodeId === k.nat.id);
    expect(loose.map((i) => i.message).join(' ')).toMatch(/public subnet[\s\S]*Route Table/);
  });

  it('rejects a route table with both an IGW and a NAT default route', () => {
    const k = withNat();
    const edges = [...k.edges, edge(k.nat.id, k.rt.id)];
    const errors = validateGraph({ nodes: k.nodes, edges }).filter((i) => i.severity === 'error');
    expect(errors.some((i) => /duplicate default route/.test(i.message))).toBe(true);
  });
});

const CERT = 'arn:aws:acm:us-east-1:123456789012:certificate/abc-123';

describe('https + dns', () => {
  function https() {
    const k = scenario();
    const alb = { ...k.alb, props: { ...k.alb.props, listener_port: 443, certificate_arn: CERT } };
    const d = addNode(k.nodes.map((n) => (n.id === alb.id ? alb : n)), 'dns', { region });
    const dns = {
      ...d.node,
      props: { ...d.node.props, zone_name: 'example.com', record_name: 'app.example.com' },
    };
    const nodes = d.nodes.map((n) => (n.id === dns.id ? dns : n));
    return { ...k, nodes, alb, dns, edges: [edge(k.alb.id, k.ec2.id), edge(dns.id, k.alb.id)] };
  }

  it('turns the listener into HTTPS with an HTTP redirect', () => {
    const k = https();
    const main = generateTerraform({ nodes: k.nodes, edges: k.edges }, { region })['main.tf'];
    expect(main).toMatch(/protocol\s+= "HTTPS"/);
    expect(main).toContain('certificate_arn');
    expect(main).toContain('ssl_policy');
    expect(main).toContain('"aws_lb_listener" "alb_1_http_redirect"');
    expect(main).toContain('type = "redirect"');
    expect(main).toContain('"alb_1_http_redirect"'); // ingress rule for port 80
  });

  it('keeps plain HTTP and no redirect without a certificate', () => {
    const k = scenario();
    const main = generateTerraform({ nodes: k.nodes, edges: [edge(k.alb.id, k.ec2.id)] }, { region })['main.tf'];
    expect(main).toMatch(/protocol\s+= "HTTP"/);
    expect(main).not.toContain('HTTPS');
    expect(main).not.toContain('redirect');
  });

  it('generates a Route 53 alias record from a DNS ↔ ALB edge', () => {
    const k = https();
    const main = generateTerraform({ nodes: k.nodes, edges: k.edges }, { region })['main.tf'];
    expect(main).toContain('data "aws_route53_zone" "dns_1"');
    expect(main).toContain('resource "aws_route53_record" "dns_1"');
    expect(main).toContain('aws_lb.alb_1.dns_name');
    expect(classifyEdge(k.nodes, edge(k.alb.id, k.dns.id)).kind).toBe('dns-alias');
  });

  it('validates certificate, record name and connections', () => {
    const k = https();
    const bad = (patch: Record<string, string>, which: 'alb' | 'dns') =>
      validateGraph({
        nodes: k.nodes.map((n) => (n.id === k[which].id ? { ...n, props: { ...n.props, ...patch } } : n)),
        edges: k.edges,
      }).filter((i) => i.severity === 'error');
    expect(bad({}, 'dns')).toEqual([]);
    expect(bad({ certificate_arn: 'not-an-arn' }, 'alb').map((i) => i.message).join()).toMatch(/ACM ARN/);
    expect(bad({ record_name: 'app.other.org' }, 'dns').map((i) => i.message).join()).toMatch(/end with \.example\.com/);
    const orphan = validateGraph({ nodes: k.nodes, edges: [] }).filter((i) => i.nodeId === k.dns.id);
    expect(orphan.map((i) => i.message).join()).toMatch(/Not connected/);
  });
});

describe('lambda', () => {
  function withFn() {
    const k = scenario();
    const fn = addNode(k.nodes, 'lambda', { region, parentId: k.priv.id });
    return { ...k, nodes: fn.nodes, fn: fn.node };
  }

  it('connects to RDS and S3 like an instance', () => {
    const k = withFn();
    expect(classifyEdge(k.nodes, edge(k.fn.id, k.rds.id)).kind).toBe('db-access');
    expect(classifyEdge(k.nodes, edge(k.bucket.id, k.fn.id)).kind).toBe('s3-access');
  });

  it('generates a VPC function with role, security group and a db rule', () => {
    const k = withFn();
    const files = generateTerraform(
      { nodes: k.nodes, edges: [edge(k.fn.id, k.rds.id), edge(k.fn.id, k.bucket.id, { access: 'readwrite' })] },
      { region },
    );
    const main = files['main.tf'];
    expect(files['providers.tf']).toContain('hashicorp/archive');
    for (const needle of [
      'resource "aws_lambda_function" "lambda_1"',
      'AWSLambdaVPCAccessExecutionRole',
      'lambda.amazonaws.com',
      'resource "aws_vpc_security_group_ingress_rule" "rds_1_from_lambda_1"',
      'data "archive_file" "lambda_1"',
      's3:PutObject',
      'vpc_config',
    ]) {
      expect(main).toContain(needle);
    }
    expect(main).not.toContain('aws_iam_instance_profile" "lambda');
  });

  it('only pulls in the archive provider when there is a function', () => {
    const k = scenario();
    expect(generateTerraform({ nodes: k.nodes, edges: [] }, { region })['providers.tf']).not.toContain('archive');
  });

  it('uses the handler to name the placeholder file', () => {
    const k = withFn();
    const nodes = k.nodes.map((n) =>
      n.id === k.fn.id ? { ...n, props: { ...n.props, runtime: 'nodejs20.x', handler: 'app.run' } } : n,
    );
    const main = generateTerraform({ nodes, edges: [] }, { region })['main.tf'];
    expect(main).toContain('filename = "app.js"');
    expect(main).toContain('exports.run');
  });

  it('validates limits and warns about S3 without a NAT route', () => {
    const k = withFn();
    const edges = [edge(k.fn.id, k.bucket.id)];
    const warn = validateGraph({ nodes: k.nodes, edges }).filter((i) => i.nodeId === k.fn.id);
    expect(warn.map((i) => i.message).join()).toMatch(/NAT Gateway/);
    const bad = k.nodes.map((n) => (n.id === k.fn.id ? { ...n, props: { ...n.props, timeout: 5000, handler: 'nodot' } } : n));
    const errors = validateGraph({ nodes: bad, edges: [] }).filter((i) => i.nodeId === k.fn.id && i.severity === 'error');
    expect(errors).toHaveLength(2);
  });
});

describe('explicit security group', () => {
  function withSg(patch: Record<string, string | boolean> = {}) {
    const k = scenario();
    const r = addNode(k.nodes, 'sg', { region, parentId: k.vpc.id });
    const sg = { ...r.node, name: 'web-access', props: { ...r.node.props, ingress_cidr: '10.0.0.0/8', ingress_ports: '22, 8000-8100', ...patch } };
    return { ...k, sg, nodes: r.nodes.map((n) => (n.id === sg.id ? sg : n)) };
  }

  it('creates the group and its rules, and attaches it next to the managed one', () => {
    const k = withSg();
    const main = generateTerraform({ nodes: k.nodes, edges: [edge(k.sg.id, k.ec2.id)] }, { region })['main.tf'];
    expect(main).toContain('resource "aws_security_group" "web_access"');
    expect(main).toContain('"web_access_22"');
    expect(main).toContain('"web_access_8000_8100"');
    expect(main).toMatch(/from_port\s+= 8000/);
    expect(main).toMatch(/vpc_security_group_ids = \[aws_security_group\.ec2_1\.id, aws_security_group\.web_access\.id\]/);
  });

  it('never starts a security group name with "sg-", which AWS reserves', () => {
    const k = withSg();
    const main = generateTerraform({ nodes: k.nodes.map((n) => (n.id === k.sg.id ? { ...n, name: 'sg-1' } : n)), edges: [] }, { region })['main.tf'];
    expect(main).toContain('name        = "av2i-sg-1-sg"');
  });

  it('validates ports/CIDR and warns about world-open SSH and unattached groups', () => {
    const k = withSg();
    expect(validateGraph({ nodes: k.nodes, edges: [] }).some((i) => /Not attached/.test(i.message))).toBe(true);
    const world = withSg({ ingress_cidr: '0.0.0.0/0' });
    expect(validateGraph({ nodes: world.nodes, edges: [] }).some((i) => /SSH\/RDP/.test(i.message))).toBe(true);
    const bad = withSg({ ingress_ports: '99999', ingress_cidr: 'nope' });
    const errors = validateGraph({ nodes: bad.nodes, edges: [] }).filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(2);
  });
});

describe('ecs', () => {
  function withEcs() {
    const k = scenario();
    const r = addNode(k.nodes, 'ecs', { region, parentId: k.s1.id });
    return { ...k, nodes: r.nodes, svc: r.node };
  }

  it('generates cluster, task definition and service wired to the load balancer by IP', () => {
    const k = withEcs();
    const main = generateTerraform({ nodes: k.nodes, edges: [edge(k.alb.id, k.svc.id), edge(k.svc.id, k.rds.id)] }, { region })['main.tf'];
    for (const needle of [
      'resource "aws_ecs_cluster" "ecs_1"',
      'resource "aws_ecs_task_definition" "ecs_1"',
      'resource "aws_ecs_service" "ecs_1"',
      'AmazonECSTaskExecutionRolePolicy',
      'ecs-tasks.amazonaws.com',
      'target_type = "ip"',
      'container_port',
      '"rds_1_from_ecs_1"',
      '"ecs_1_from_alb_1"',
    ]) {
      expect(main).toContain(needle);
    }
    expect(main).not.toContain('aws_lb_target_group_attachment');
    expect(main).toMatch(/assign_public_ip = true/); // s1 is a public subnet
  });

  it('rejects mixing EC2 and ECS targets and bad cpu/memory pairs', () => {
    const k = withEcs();
    const mixed = validateGraph({ nodes: k.nodes, edges: [edge(k.alb.id, k.svc.id), edge(k.alb.id, k.ec2.id)] });
    expect(mixed.some((i) => /not both/.test(i.message))).toBe(true);
    const bad = k.nodes.map((n) => (n.id === k.svc.id ? { ...n, props: { ...n.props, cpu: '256', memory: 8192 } } : n));
    expect(validateGraph({ nodes: bad, edges: [] }).some((i) => /does not offer 8192 MB/.test(i.message))).toBe(true);
  });
});

describe('cloudfront', () => {
  function withCdn(patch: Record<string, string> = {}) {
    const k = scenario();
    const r = addNode(k.nodes, 'cdn', { region });
    const cdn = { ...r.node, props: { ...r.node.props, ...patch } };
    return { ...k, cdn, nodes: r.nodes.map((n) => (n.id === cdn.id ? cdn : n)) };
  }

  it('serves S3 through an origin access control and a bucket policy', () => {
    const k = withCdn();
    const main = generateTerraform({ nodes: k.nodes, edges: [edge(k.cdn.id, k.bucket.id)] }, { region })['main.tf'];
    for (const needle of [
      'resource "aws_cloudfront_distribution" "cdn_1"',
      'aws_cloudfront_origin_access_control',
      'resource "aws_s3_bucket_policy" "cdn_1"',
      'AWS:SourceArn',
      'Managed-CachingOptimized',
      'default_root_object',
      'cloudfront_default_certificate = true',
    ]) {
      expect(main).toContain(needle);
    }
  });

  it('can front a load balancer, and a DNS record can alias the distribution', () => {
    const k = withCdn({ aliases: 'www.example.com', certificate_arn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc' });
    const d = addNode(k.nodes, 'dns', { region });
    const dns = { ...d.node, props: { ...d.node.props, zone_name: 'example.com', record_name: 'www.example.com' } };
    const nodes = d.nodes.map((n) => (n.id === dns.id ? dns : n));
    const edges = [edge(k.cdn.id, k.alb.id), edge(dns.id, k.cdn.id)];
    const main = generateTerraform({ nodes, edges }, { region })['main.tf'];
    expect(main).toContain('custom_origin_config');
    expect(main).toContain('Managed-CachingDisabled');
    expect(main).toContain('aws_cloudfront_distribution.cdn_1.hosted_zone_id');
    expect(main).toMatch(/evaluate_target_health = false/);
    expect(main).toContain('acm_certificate_arn');
    expect(validateGraph({ nodes, edges }).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('validates aliases, certificate region and origins', () => {
    const noCert = withCdn({ aliases: 'www.example.com' });
    expect(validateGraph({ nodes: noCert.nodes, edges: [] }).some((i) => /need an ACM certificate/.test(i.message))).toBe(true);
    const wrongRegion = withCdn({ certificate_arn: 'arn:aws:acm:eu-west-1:123456789012:certificate/abc' });
    expect(validateGraph({ nodes: wrongRegion.nodes, edges: [] }).some((i) => /us-east-1/.test(i.message))).toBe(true);
    const two = withCdn();
    const issues = validateGraph({ nodes: two.nodes, edges: [edge(two.cdn.id, two.bucket.id), edge(two.cdn.id, two.alb.id)] });
    expect(issues.some((i) => /one origin/.test(i.message))).toBe(true);
  });
});

describe('templates', () => {
  for (const t of TEMPLATES) {
    it(`${t.id} has no errors and generates terraform`, () => {
      const graph = t.build(region);
      expect(graph.nodes.length).toBeGreaterThan(0);
      const errors = validateGraph(graph).filter((i) => i.severity === 'error');
      expect(errors, JSON.stringify(errors)).toEqual([]);
      expect(generateTerraform(graph, { region })['main.tf']).toContain('resource "aws_');
    });
  }
});

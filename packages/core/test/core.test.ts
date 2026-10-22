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
  alignNodes,
  copySelection,
  distributeNodes,
  estimateCost,
  importTerraform,
  parseHcl,
  resolveEdges,
  pasteFragment,
  TEMPLATES,
  validateGraph,
  labelPoint,
  parseRules,
  pathFromPoints,
  routeEdges,
  routerNodes,
  sgRules,
  serializeRules,
  type GraphNode,
} from '../src';
import { addSg, build, edge, ingressProps, region, rule, scenario } from './fixtures';

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
    expect(issues.filter((i) => !i.category && /route|Route|No targets|associated|facing/.test(i.message))).toEqual([]);
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
  const office = [{ ports: '22, 8000-8100', peer: '10.0.0.0/8' }];
  function withSg(rules: Partial<Parameters<typeof rule>[0] & object>[] = office) {
    const k = scenario();
    const r = addSg(k.nodes, k.vpc.id, 'web-access', rules);
    return { ...k, sg: r.sg, nodes: r.nodes };
  }
  const tf = (k: { nodes: GraphNode[] }, edges: ReturnType<typeof edge>[] = []) =>
    generateTerraform({ nodes: k.nodes, edges }, { region })['main.tf'];

  it('creates the group and one rule per port range, and uses it instead of a managed group', () => {
    const k = withSg();
    const main = tf(k, [edge(k.sg.id, k.ec2.id)]);
    expect(main).toContain('resource "aws_security_group" "web_access"');
    expect(main).toContain('"web_access_in_tcp_22_10_0_0_0_8"');
    expect(main).toContain('"web_access_in_tcp_8000_8100_10_0_0_0_8"');
    expect(main).toMatch(/from_port\s+= 8000/);
    expect(main).toMatch(/vpc_security_group_ids = \[aws_security_group\.web_access\.id\]/);
    expect(main).not.toContain('resource "aws_security_group" "ec2_1"');
  });

  it('keeps the managed group for resources with nothing attached', () => {
    const k = withSg();
    const main = tf(k, [edge(k.sg.id, k.ec2.id)]);
    expect(main).toContain('resource "aws_security_group" "rds_1"');
  });

  it('supports several rules with different sources, protocols and descriptions', () => {
    const k = withSg([
      { ports: '22', peer: '203.0.113.0/24', description: 'office' },
      { ports: '443', peer: '0.0.0.0/0' },
      { protocol: 'udp', ports: '53', peer: '10.0.0.0/16' },
      { protocol: 'icmp', peer: '10.0.0.0/16' },
      { protocol: 'all', peer: '10.1.0.0/16' },
    ]);
    const main = tf(k, [edge(k.sg.id, k.ec2.id)]);
    expect(main).toContain('"web_access_in_tcp_22_203_0_113_0_24"');
    expect(main).toContain('"web_access_in_tcp_443_0_0_0_0_0"');
    expect(main).toContain('"web_access_in_udp_53_10_0_0_0_16"');
    expect(main).toMatch(/ip_protocol\s+= "icmp"\n\s+from_port\s+= -1/);
    const all = main.slice(main.indexOf('"web_access_in_all_all_'));
    expect(all.slice(0, all.indexOf('}'))).not.toContain('from_port');
    expect(main).toContain('description       = "office"');
  });

  it('writes outbound rules, and none when the list is empty', () => {
    const k = withSg();
    expect(tf(k)).toContain('"web_access_out_all_all_0_0_0_0_0"');
    const closed = { ...k, nodes: k.nodes.map((n) => (n.id === k.sg.id ? { ...n, props: { ...n.props, egress_rules: '[]' } } : n)) };
    expect(tf(closed)).not.toContain('web_access_out_');
  });

  it('lets a group name another group as the source', () => {
    const k = withSg([]);
    const db = addSg(k.nodes, k.vpc.id, 'data', []);
    const nodes = db.nodes.map((n) =>
      n.id === db.sg.id ? { ...n, props: { ...n.props, ...ingressProps({ ports: '5432', peer: `sg:${k.sg.id}` }) } } : n,
    );
    const main = tf({ nodes });
    expect(main).toContain('"data_in_tcp_5432_web_access"');
    expect(main).toMatch(/referenced_security_group_id = aws_security_group\.web_access\.id/);
    expect(validateGraph({ nodes, edges: [] }).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('flags rules that name a group in another VPC or a missing one', () => {
    const k = withSg([]);
    const vpc2 = addNode(k.nodes, 'vpc', { region, position: { x: 700, y: 0 } });
    const other = addSg(vpc2.nodes, vpc2.node.id, 'elsewhere', []);
    const mine = addSg(other.nodes, k.vpc.id, 'mine', [{ ports: '80', peer: `sg:${other.sg.id}` }, { ports: '80', peer: 'sg:gone' }]);
    const errors = validateGraph({ nodes: mine.nodes, edges: [] }).filter((i) => i.severity === 'error').map((i) => i.message);
    expect(errors.some((m) => /another VPC/.test(m))).toBe(true);
    expect(errors.some((m) => /no longer exists/.test(m))).toBe(true);
    expect(tf({ nodes: mine.nodes })).not.toContain('"mine_in_tcp_80_elsewhere"');
  });

  it('never starts a security group name with "sg-", which AWS reserves', () => {
    const k = withSg();
    const main = tf({ nodes: k.nodes.map((n) => (n.id === k.sg.id ? { ...n, name: 'sg-1' } : n)) });
    expect(main).toContain('name        = "av2i-sg-1-sg"');
  });

  it('validates ports/CIDR and warns about world-open SSH and unattached groups', () => {
    const k = withSg();
    expect(validateGraph({ nodes: k.nodes, edges: [] }).some((i) => /Not attached/.test(i.message))).toBe(true);
    const world = withSg([{ ports: '22', peer: '0.0.0.0/0' }]);
    expect(validateGraph({ nodes: world.nodes, edges: [] }).some((i) => /SSH\/RDP/.test(i.message))).toBe(true);
    const bad = withSg([{ ports: '99999', peer: 'nope' }, { ports: '80', peer: '' }]);
    const errors = validateGraph({ nodes: bad.nodes, edges: [] }).filter((i) => i.severity === 'error');
    expect(errors.map((i) => i.message).join('\n')).toMatch(/Inbound rule 1: ports[\s\S]*Inbound rule 1: invalid CIDR[\s\S]*Inbound rule 2: the source is empty/);
  });

  it('reads groups saved with the old single-rule props', () => {
    const k = scenario();
    const r = addNode(k.nodes, 'sg', { region, parentId: k.vpc.id });
    const { ingress_rules, egress_rules, ...rest } = r.node.props;
    const legacy = { ...r.node, props: { ...rest, ingress_cidr: '10.0.0.0/8', ingress_ports: '22, 8000-8100', egress_all: false } };
    expect(sgRules(legacy, 'ingress')).toEqual([{ protocol: 'tcp', ports: '22, 8000-8100', peer: '10.0.0.0/8', description: '' }]);
    expect(sgRules(legacy, 'egress')).toEqual([]);
    expect(sgRules({ ...legacy, props: { ...rest } }, 'egress')).toHaveLength(1);
  });

  it('drops rules that name a deleted group, and survives copy/paste of groups that name each other', () => {
    const k = withSg([]);
    const b = addSg(k.nodes, k.vpc.id, 'b', [{ ports: '80', peer: `sg:${k.sg.id}` }]);
    const after = removeNode({ nodes: b.nodes, edges: [] }, k.sg.id);
    expect(sgRules(after.nodes.find((n) => n.id === b.sg.id)!, 'ingress')).toEqual([]);

    const pair = addSg(b.nodes, k.vpc.id, 'c', [{ ports: '80', peer: `sg:${b.sg.id}` }]);
    const graph = { nodes: pair.nodes, edges: [] };
    const pasted = pasteFragment(graph, copySelection(graph, [b.sg.id, pair.sg.id]), { x: 20, y: 20 });
    const copies = pasted.graph.nodes.filter((n) => n.type === 'sg' && /-copy/.test(n.name));
    const copyB = copies.find((n) => n.name.startsWith('b'))!;
    const copyC = copies.find((n) => n.name.startsWith('c'))!;
    expect(sgRules(copyC, 'ingress')[0].peer).toBe(`sg:${copyB.id}`);
  });
});

describe('shared and default security groups', () => {
  const tf = (nodes: GraphNode[], edges: ReturnType<typeof edge>[]) => generateTerraform({ nodes, edges }, { region })['main.tf'];

  it('one group on several resources is created once, with its rules once', () => {
    const k = scenario();
    const second = addNode(k.nodes, 'ec2', { region, parentId: k.s2.id });
    const web = addSg(second.nodes, k.vpc.id, 'app', [{ ports: '8080', peer: '10.0.0.0/16' }]);
    const main = tf(web.nodes, [edge(web.sg.id, k.ec2.id), edge(web.sg.id, second.node.id)]);
    expect(main.match(/resource "aws_security_group" "app"/g)).toHaveLength(1);
    expect(main.match(/"app_in_tcp_8080_10_0_0_0_16"/g)).toHaveLength(1);
    expect(main.match(/vpc_security_group_ids = \[aws_security_group\.app\.id\]/g)).toHaveLength(2);
  });

  it('connection rules go on the drawn groups, once, even when resources share them', () => {
    const k = scenario();
    const second = addNode(k.nodes, 'ec2', { region, parentId: k.s2.id });
    const app = addSg(second.nodes, k.vpc.id, 'app', []);
    const data = addSg(app.nodes, k.vpc.id, 'data', []);
    const main = tf(data.nodes, [
      edge(app.sg.id, k.ec2.id),
      edge(app.sg.id, second.node.id),
      edge(data.sg.id, k.rds.id),
      edge(k.ec2.id, k.rds.id),
      edge(second.node.id, k.rds.id),
    ]);
    expect(main.match(/referenced_security_group_id/g)).toHaveLength(1);
    expect(main).toMatch(/security_group_id\s+= aws_security_group\.data\.id\s+referenced_security_group_id = aws_security_group\.app\.id/);
    expect(main).not.toContain('resource "aws_security_group" "rds_1"');
    expect(main).not.toContain('resource "aws_security_group" "ec2_1"');
  });

  it('does not repeat a connection rule the group already has', () => {
    const k = scenario();
    const app = addSg(k.nodes, k.vpc.id, 'app', []);
    const data = addSg(app.nodes, k.vpc.id, 'data', [{ ports: '5432', peer: `sg:${app.sg.id}` }]);
    const main = tf(data.nodes, [edge(app.sg.id, k.ec2.id), edge(data.sg.id, k.rds.id), edge(k.ec2.id, k.rds.id)]);
    expect(main.match(/referenced_security_group_id/g)).toHaveLength(1);
  });

  it('a load balancer with its own group gets no automatic world-open listener rule, but is warned when none allows it', () => {
    const k = scenario();
    const open = addSg(k.nodes, k.vpc.id, 'edge', []);
    const edges = [edge(open.sg.id, k.alb.id)];
    expect(tf(open.nodes, edges)).not.toContain(`"${'alb_1'}_listener"`);
    expect(validateGraph({ nodes: open.nodes, edges }).some((i) => i.nodeId === k.alb.id && /listener port 80/.test(i.message))).toBe(true);
    const ok = addSg(k.nodes, k.vpc.id, 'edge', [{ ports: '80' }]);
    expect(validateGraph({ nodes: ok.nodes, edges: [edge(ok.sg.id, k.alb.id)] }).some((i) => i.nodeId === k.alb.id && /listener port/.test(i.message))).toBe(false);
    expect(tf(k.nodes, [])).toContain('"alb_1_listener"');
  });

  it('the VPC default group replaces the per-resource ones', () => {
    const k = scenario();
    const shared = addSg(k.nodes, k.vpc.id, 'shared', [{ ports: '8080', peer: '10.0.0.0/16' }]);
    const nodes = shared.nodes.map((n) => (n.id === k.vpc.id ? { ...n, props: { ...n.props, default_sg: shared.sg.id } } : n));
    const main = tf(nodes, [edge(k.ec2.id, k.rds.id)]);
    expect(main.match(/resource "aws_security_group"/g)).toHaveLength(1);
    expect(main.match(/vpc_security_group_ids\s+= \[aws_security_group\.shared\.id\]/g)).toHaveLength(2);
    expect(validateGraph({ nodes, edges: [] }).some((i) => /Not attached/.test(i.message))).toBe(false);
    // an attached group still wins over the default
    const own = addSg(nodes, k.vpc.id, 'own', []);
    expect(tf(own.nodes, [edge(own.sg.id, k.ec2.id)])).toMatch(/vpc_security_group_ids\s+= \[aws_security_group\.own\.id\]/);
  });

  it('clears the default when its group is deleted, and rejects one from another VPC', () => {
    const k = scenario();
    const shared = addSg(k.nodes, k.vpc.id, 'shared', []);
    const nodes = shared.nodes.map((n) => (n.id === k.vpc.id ? { ...n, props: { ...n.props, default_sg: shared.sg.id } } : n));
    const after = removeNode({ nodes, edges: [] }, shared.sg.id);
    expect(after.nodes.find((n) => n.id === k.vpc.id)!.props.default_sg).toBe('');
    const vpc2 = addNode(nodes, 'vpc', { region, position: { x: 700, y: 0 } });
    const foreign = addSg(vpc2.nodes, vpc2.node.id, 'foreign', []);
    const bad = foreign.nodes.map((n) => (n.id === k.vpc.id ? { ...n, props: { ...n.props, default_sg: foreign.sg.id } } : n));
    expect(validateGraph({ nodes: bad, edges: [] }).some((i) => i.nodeId === k.vpc.id && /default security group/.test(i.message))).toBe(true);
  });

  it('copying a VPC repoints its default group at the copy', () => {
    const k = scenario();
    const shared = addSg(k.nodes, k.vpc.id, 'shared', []);
    const nodes = shared.nodes.map((n) => (n.id === k.vpc.id ? { ...n, props: { ...n.props, default_sg: shared.sg.id } } : n));
    const graph = { nodes, edges: [] };
    const pasted = pasteFragment(graph, copySelection(graph, [k.vpc.id]), { x: 600, y: 0 });
    const copyVpc = pasted.graph.nodes.find((n) => n.id === pasted.newIds[0])!;
    const copySg = pasted.graph.nodes.find((n) => n.type === 'sg' && n.id !== shared.sg.id)!;
    expect(copyVpc.props.default_sg).toBe(copySg.id);
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

describe('security', () => {
  const sgWith = (k: ReturnType<typeof scenario>, ports: string, protocol: 'tcp' | 'udp' | 'all' = 'tcp') =>
    addSg(k.nodes, k.vpc.id, 'open', [{ protocol, ports, peer: '0.0.0.0/0' }]);
  const security = (graph: Parameters<typeof validateGraph>[0], nodeId?: string) =>
    validateGraph(graph).filter((i) => i.category === 'security' && (!nodeId || i.nodeId === nodeId));

  it('flags world-open SSH, databases and odd ports but not web ports', () => {
    const k = scenario();
    const web = sgWith(k, '80, 443');
    expect(security({ nodes: web.nodes, edges: [] }, web.sg.id)).toEqual([]);
    const ssh = sgWith(k, '22');
    expect(security({ nodes: ssh.nodes, edges: [] }, ssh.sg.id)[0]).toMatchObject({ severity: 'warning', category: 'security' });
    const db = sgWith(k, '5432');
    expect(security({ nodes: db.nodes, edges: [] }, db.sg.id)[0]).toMatchObject({ severity: 'error' });
    const odd = sgWith(k, '8080');
    expect(security({ nodes: odd.nodes, edges: [] }, odd.sg.id)[0].message).toMatch(/8080/);
  });

  it('flags open-to-everything rules', () => {
    const k = scenario();
    const all = sgWith(k, '', 'all');
    expect(security({ nodes: all.nodes, edges: [] }, all.sg.id)[0]).toMatchObject({ severity: 'error' });
    const everyPort = sgWith(k, '');
    expect(security({ nodes: everyPort.nodes, edges: [] }, everyPort.sg.id)[0].message).toMatch(/Every TCP port/);
    const dns = sgWith(k, '53', 'udp');
    expect(security({ nodes: dns.nodes, edges: [] }, dns.sg.id)[0].message).toMatch(/UDP port 53/);
  });

  it('errors when a world-open group is attached to a database', () => {
    const k = scenario();
    const open = sgWith(k, '8080');
    const issues = security({ nodes: open.nodes, edges: [edge(open.sg.id, k.rds.id)] });
    expect(issues.some((i) => i.nodeId === k.rds.id && i.severity === 'error')).toBe(true);
  });

  it('warns about databases in public subnets and plain-HTTP public load balancers', () => {
    const k = scenario();
    const pub = addNode(k.nodes, 'rds', { region, parentId: k.s1.id });
    expect(security({ nodes: pub.nodes, edges: [] }).some((i) => i.nodeId === pub.node.id && /public subnet/.test(i.message))).toBe(true);
    expect(security({ nodes: k.nodes, edges: [] }).some((i) => i.nodeId === k.alb.id && /plain HTTP/.test(i.message))).toBe(true);
    const https = k.nodes.map((n) => (n.id === k.alb.id ? { ...n, props: { ...n.props, certificate_arn: 'arn:aws:acm:us-east-1:123456789012:certificate/x' } } : n));
    expect(security({ nodes: https, edges: [] }).some((i) => i.nodeId === k.alb.id)).toBe(false);
  });

  it('generates hardened defaults: IMDSv2, encryption, blocked public S3 access', () => {
    const k = scenario();
    const main = generateTerraform({ nodes: k.nodes, edges: [] }, { region })['main.tf'];
    expect(main).toContain('http_tokens   = "required"');
    expect(main).toMatch(/encrypted\s+= true/);
    expect(main).toMatch(/storage_encrypted\s+= true/);
    expect(main).toContain('aws_s3_bucket_public_access_block');
  });
});

describe('cost estimate', () => {
  const cost = (nodes: GraphNode[], edges = [] as ReturnType<typeof edge>[], r = region) =>
    estimateCost({ nodes, edges }, { region: r });

  it('prices gateways, load balancers and instances', () => {
    const k = scenario();
    const nat = addNode(k.nodes, 'nat', { region, parentId: k.s1.id });
    const byName = Object.fromEntries(cost(nat.nodes).items.map((i) => [i.type, i]));
    expect(byName.nat.monthly).toBeCloseTo(36.5, 1); // 32.85 NAT + 3.65 Elastic IP
    expect(byName.alb.monthly).toBeCloseTo(16.43, 1);
    expect(byName.ec2.monthly).toBeCloseTo(7.59 + 0.64 + 3.65, 1); // t3.micro + 8 GiB + public IPv4 (s1 is public)
    expect(byName.s3.monthly).toBe(0);
    expect(byName.s3.usage).toBeTruthy();
  });

  it('doubles RDS for Multi-AZ and scales ECS by task count', () => {
    const k = scenario();
    const single = cost(k.nodes).items.find((i) => i.type === 'rds')!.monthly;
    const multi = cost(k.nodes.map((n) => (n.id === k.rds.id ? { ...n, props: { ...n.props, multi_az: true } } : n))).items.find((i) => i.type === 'rds')!.monthly;
    expect(multi).toBeCloseTo(single * 2, 5);
    const one = addNode(k.nodes, 'ecs', { region, parentId: k.s1.id });
    const per = cost(one.nodes).items.find((i) => i.type === 'ecs')!.monthly;
    const three = one.nodes.map((n) => (n.id === one.node.id ? { ...n, props: { ...n.props, desired_count: 3 } } : n));
    expect(cost(three).items.find((i) => i.type === 'ecs')!.monthly).toBeCloseTo(per * 3, 5);
  });

  it('totals the items, applies a regional factor, and ignores free resources', () => {
    const k = scenario();
    const base = cost(k.nodes);
    expect(base.total).toBeCloseTo(base.items.reduce((s, i) => s + i.monthly, 0), 8);
    expect(base.items.some((i) => i.type === 'vpc' || i.type === 'subnet')).toBe(false);
    expect(cost(k.nodes, [], 'ap-southeast-1').total).toBeCloseTo(base.total * 1.25, 5);
  });
});

describe('copy and paste', () => {
  it('copies nested nodes and the edges between them, with new ids and names', () => {
    const k = scenario();
    const graph = { nodes: k.nodes, edges: [edge(k.igw.id, k.rt.id), edge(k.ec2.id, k.rds.id)] };
    const fragment = copySelection(graph, [k.s1.id, k.igw.id, k.rt.id]);
    expect(fragment.rootIds).toHaveLength(3);
    expect(fragment.nodes.some((n) => n.id === k.ec2.id)).toBe(true); // child of s1 rides along
    expect(fragment.edges.map((e) => e.id)).toEqual([`${k.igw.id}-${k.rt.id}`]); // ec2-rds crosses the selection
    const pasted = pasteFragment(graph, fragment, { x: 40, y: 40 });
    expect(pasted.graph.nodes).toHaveLength(graph.nodes.length + fragment.nodes.length);
    expect(new Set(pasted.graph.nodes.map((n) => n.id)).size).toBe(pasted.graph.nodes.length);
    expect(pasted.graph.edges).toHaveLength(graph.edges.length + 1);
    const names = pasted.graph.nodes.map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('igw-1-copy');
    expect(pasted.newIds).toHaveLength(3);
  });

  it('gives pasted subnets a free CIDR and pasted buckets a new name', () => {
    const k = scenario();
    const graph = { nodes: k.nodes, edges: [] };
    const sub = pasteFragment(graph, copySelection(graph, [k.s1.id]), { x: 0, y: 200 });
    const cidrs = sub.graph.nodes.filter((n) => n.type === 'subnet').map((n) => n.props.cidr_block);
    expect(new Set(cidrs).size).toBe(cidrs.length);
    const bucket = pasteFragment(graph, copySelection(graph, [k.bucket.id]), { x: 40, y: 40 });
    const buckets = bucket.graph.nodes.filter((n) => n.type === 's3').map((n) => n.props.bucket);
    expect(new Set(buckets).size).toBe(2);
    expect(validateGraph(sub.graph).filter((i) => i.severity === 'error' && /overlaps/.test(i.message))).toEqual([]);
  });

  it('skips nodes whose container is gone and keeps pasted containers valid', () => {
    const k = scenario();
    const graph = { nodes: k.nodes, edges: [] };
    const fragment = copySelection(graph, [k.ec2.id]);
    const without = removeNode(graph, k.s1.id);
    const pasted = pasteFragment(without, fragment, { x: 40, y: 40 });
    expect(pasted.skipped).toBe(1);
    expect(pasted.graph.nodes).toHaveLength(without.nodes.length);
    const whole = pasteFragment(graph, copySelection(graph, [k.vpc.id]), { x: 600, y: 0 });
    const vpcs = whole.graph.nodes.filter((n) => n.type === 'vpc');
    expect(vpcs).toHaveLength(2);
    expect(validateGraph(whole.graph).filter((i) => /must be placed inside/.test(i.message))).toEqual([]);
  });
});

describe('align and distribute', () => {
  function row() {
    const k = scenario();
    const place = (id: string, x: number, y: number) =>
      k.nodes.map((n) => (n.id === id ? { ...n, position: { x, y } } : n));
    return { k, place };
  }

  it('aligns siblings and refuses mixed containers', () => {
    const { k } = row();
    const nodes = k.nodes.map((n) =>
      n.id === k.igw.id ? { ...n, position: { x: 30, y: 400 } } : n.id === k.alb.id ? { ...n, position: { x: 90, y: 440 } } : n,
    );
    const left = alignNodes(nodes, [k.igw.id, k.alb.id], 'left')!;
    expect(left.find((n) => n.id === k.igw.id)!.position.x).toBe(30);
    expect(left.find((n) => n.id === k.alb.id)!.position.x).toBe(30);
    const bottom = alignNodes(nodes, [k.igw.id, k.alb.id], 'bottom')!;
    const [a, b] = [k.igw.id, k.alb.id].map((id) => bottom.find((n) => n.id === id)!);
    expect(a.position.y + a.size.height).toBe(b.position.y + b.size.height);
    expect(alignNodes(nodes, [k.igw.id, k.ec2.id], 'left')).toBeNull(); // different parents
    expect(alignNodes(nodes, [k.igw.id], 'left')).toBeNull();
  });

  it('spreads three nodes with equal gaps and keeps the outer two in place', () => {
    const { k } = row();
    const ids = [k.igw.id, k.rt.id, k.alb.id];
    const xs = [20, 60, 400];
    const nodes = k.nodes.map((n) => (ids.includes(n.id) ? { ...n, position: { x: xs[ids.indexOf(n.id)], y: 420 } } : n));
    const out = distributeNodes(nodes, ids, 'horizontal')!;
    const [a, b, c] = ids.map((id) => out.find((n) => n.id === id)!);
    expect(a.position.x).toBe(20);
    expect(c.position.x).toBe(400);
    expect(b.position.x - (a.position.x + a.size.width)).toBeCloseTo(c.position.x - (b.position.x + b.size.width), 0);
    expect(distributeNodes(nodes, ids.slice(0, 2), 'horizontal')).toBeNull();
  });
});

describe('terraform import', () => {
  const tally = (graph: Parameters<typeof resolveEdges>[0]) => ({
    nodes: graph.nodes.map((n) => n.type).sort(),
    edges: resolveEdges(graph).map((r) => r.kind).sort(),
  });
  const roundTrip = (graph: Parameters<typeof resolveEdges>[0]) =>
    importTerraform(Object.values(generateTerraform(graph, { region })).join('\n'));

  it('parses what the generator writes', () => {
    for (const t of TEMPLATES) {
      for (const text of Object.values(generateTerraform(t.build(region), { region }))) {
        const blocks = parseHcl(text);
        expect(blocks.filter((b) => b.type === 'resource')).toHaveLength((text.match(/^resource "/gm) ?? []).length);
      }
    }
  });

  it('round-trips every template: same resources, same connections', () => {
    for (const t of TEMPLATES) {
      const original = t.build(region);
      const result = roundTrip(original);
      expect(tally(result.graph), t.id).toEqual(tally(original));
      expect(result.region).toBe(region);
      expect(result.report.skipped, t.id).toEqual({});
      const errors = validateGraph(result.graph).filter((i) => i.severity === 'error');
      expect(errors, `${t.id}: ${JSON.stringify(errors)}`).toEqual([]);
    }
  });

  it('keeps settings and names through a round trip', () => {
    const k = scenario();
    const graph = {
      nodes: k.nodes.map((n) =>
        n.id === k.ec2.id ? { ...n, name: 'app-server', props: { ...n.props, instance_type: 't3.medium', root_volume_size: 30 } }
        : n.id === k.rds.id ? { ...n, props: { ...n.props, engine: 'mysql', multi_az: true, allocated_storage: 50 } }
        : n.id === k.alb.id ? { ...n, props: { ...n.props, listener_port: 443, certificate_arn: CERT } }
        : n),
      edges: [edge(k.igw.id, k.rt.id), edge(k.rt.id, k.s1.id), edge(k.alb.id, k.ec2.id), edge(k.ec2.id, k.rds.id), edge(k.ec2.id, k.bucket.id, { access: 'readwrite' })],
    };
    const { graph: back } = roundTrip(graph);
    const ec2 = back.nodes.find((n) => n.type === 'ec2')!;
    expect(ec2.name).toBe('app-server');
    expect(ec2.props).toMatchObject({ instance_type: 't3.medium', root_volume_size: 30 });
    expect(back.nodes.find((n) => n.type === 'rds')!.props).toMatchObject({ engine: 'mysql', multi_az: true, allocated_storage: 50 });
    expect(back.nodes.find((n) => n.type === 'alb')!.props).toMatchObject({ listener_port: 443, certificate_arn: CERT, redirect_http: true });
    expect(back.edges.find((e) => resolveEdges(back).find((r) => r.edge.id === e.id)?.kind === 's3-access')!.props).toEqual({ access: 'readwrite' });
    expect(back.nodes.filter((n) => n.type === 'subnet').map((n) => n.props.cidr_block).sort()).toEqual(
      k.nodes.filter((n) => n.type === 'subnet').map((n) => n.props.cidr_block).sort(),
    );
  });

  it('imports hand-written Terraform, ignoring comments, variables and what it cannot draw', () => {
    const result = importTerraform(`
      # networking
      variable "env" { default = "dev" }
      provider "aws" { region = "eu-west-1" }
      resource "aws_vpc" "main" {
        cidr_block = var.cidr
        tags = { Name = "prod-${'$'}{var.env}" }
      }
      resource "aws_vpc" "lab" { cidr_block = "172.16.0.0/16" }
      resource "aws_subnet" "a" {
        vpc_id = aws_vpc.lab.id
        cidr_block = "172.16.1.0/24"
        availability_zone = "eu-west-1a"
        map_public_ip_on_launch = true
      }
      resource "aws_subnet" "orphan" { vpc_id = aws_vpc.elsewhere.id cidr_block = "10.9.0.0/24" }
      resource "aws_instance" "web" {
        subnet_id = aws_subnet.a.id
        instance_type = "t3.small"
        ami = "ami-123"
      }
      resource "aws_security_group" "ssh" {
        vpc_id = aws_vpc.lab.id
        description = "office ssh"
        ingress {
          from_port = 22
          to_port = 22
          protocol = "tcp"
          cidr_blocks = ["203.0.113.0/24"]
        }
      }
      resource "aws_sqs_queue" "jobs" { name = "jobs" }
    `);
    expect(result.region).toBe('eu-west-1');
    expect(result.report.imported).toMatchObject({ vpc: 2, subnet: 1, ec2: 1, sg: 1 });
    expect(result.report.skipped).toMatchObject({ aws_sqs_queue: 1, aws_subnet: 1 });
    expect(result.report.warnings.join(' ')).toMatch(/orphan/);
    const sg = result.graph.nodes.find((n) => n.type === 'sg')!;
    expect(sgRules(sg, 'ingress')).toEqual([{ protocol: 'tcp', ports: '22', peer: '203.0.113.0/24', description: '' }]);
    expect(result.graph.nodes.find((n) => n.type === 'ec2')!.props).toMatchObject({ instance_type: 't3.small', ami: 'ami-123' });
    expect(result.graph.edges).toHaveLength(0); // the group isn't attached to anything
    expect(result.graph.nodes.some((n) => n.type === 'vpc' && n.name === 'main')).toBe(true);
  });

  it('imports explicit security groups, Lambda and CloudFront from generated output', () => {
    const k = scenario();
    const sg = addSg(k.nodes, k.vpc.id, 'office', [
      { ports: '22, 8000-8100', peer: '10.0.0.0/8', description: 'office' },
      { protocol: 'udp', ports: '53', peer: '10.0.0.0/16' },
      { protocol: 'icmp', peer: '10.0.0.0/16' },
      { protocol: 'all', peer: '10.2.0.0/16' },
    ]);
    const sgNode = sg.sg;
    const peerSg = addSg(sg.nodes, k.vpc.id, 'peer', [{ ports: '8080', peer: `sg:${sgNode.id}` }]);
    const fn = addNode(peerSg.nodes, 'lambda', { region, parentId: k.priv.id });
    const cdn = addNode(fn.nodes, 'cdn', { region });
    const graph = {
      nodes: cdn.nodes,
      edges: [edge(sgNode.id, k.ec2.id), edge(peerSg.sg.id, k.rds.id), edge(fn.node.id, k.rds.id), edge(fn.node.id, k.bucket.id), edge(cdn.node.id, k.bucket.id)],
    };
    const { graph: back } = roundTrip(graph);
    expect(tally(back)).toEqual(tally(graph));
    const backOffice = back.nodes.find((n) => n.name === 'office')!;
    const backPeer = back.nodes.find((n) => n.name === 'peer')!;
    // Terraform has one rule per port range, so "22, 8000-8100" comes back as two rules.
    const [ssh, ...others] = sgRules(sgNode, 'ingress');
    expect(sgRules(backOffice, 'ingress')).toEqual([
      { ...ssh, ports: '22' },
      { ...ssh, ports: '8000-8100' },
      ...others,
    ]);
    expect(sgRules(backOffice, 'egress')).toEqual(sgRules(sgNode, 'egress'));
    expect(sgRules(backPeer, 'ingress')).toEqual([{ protocol: 'tcp', ports: '8080', peer: `sg:${backOffice.id}`, description: '' }]);
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

describe('edge routing', () => {
  const box = (id: string, x: number, y: number, w = 140, h = 64, container = false) => ({ id, rect: { x, y, width: w, height: h }, container });
  type Pt = { x: number; y: number };
  /** Does the axis-aligned segment a-b pass through the rectangle (shrunk by 1px)? */
  const hits = (a: Pt, b: Pt, r: { x: number; y: number; width: number; height: number }) => {
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    return x1 > r.x + 1 && x0 < r.x + r.width - 1 && y1 > r.y + 1 && y0 < r.y + r.height - 1;
  };
  const segments = (pts: Pt[]) => pts.slice(1).map((p, i) => [pts[i], p] as const);

  it('draws right-angled routes from border to border, around what is in the way', () => {
    const nodes = [box('a', 0, 100), box('b', 500, 100), box('wall', 250, 60, 40, 140)];
    const routes = routeEdges(nodes, [{ id: 'e', source: 'a', target: 'b' }]);
    const pts = routes.get('e')!;
    expect(pts.length).toBeGreaterThan(2);
    for (const [p, q] of segments(pts)) {
      expect(p.x === q.x || p.y === q.y).toBe(true);
      expect(hits(p, q, nodes[2].rect)).toBe(false);
    }
    const onBorder = (p: Pt, r: (typeof nodes)[0]['rect']) =>
      (p.x === r.x || p.x === r.x + r.width || p.y === r.y || p.y === r.y + r.height) &&
      p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
    expect(onBorder(pts[0], nodes[0].rect)).toBe(true);
    expect(onBorder(pts[pts.length - 1], nodes[1].rect)).toBe(true);
  });

  it('keeps edges that share an end on separate lanes', () => {
    const nodes = [box('a', 0, 160), box('b', 400, 0), box('c', 400, 160), box('d', 400, 320)];
    const edges = ['b', 'c', 'd'].map((t) => ({ id: `e-${t}`, source: 'a', target: t }));
    const routes = routeEdges(nodes, edges);
    const lines: string[] = [];
    for (const e of edges) {
      for (const [p, q] of segments(routes.get(e.id)!)) {
        if (Math.hypot(p.x - q.x, p.y - q.y) < 15) continue;
        // a lane is a line plus the span it covers
        lines.push(p.x === q.x ? `v${p.x}:${Math.min(p.y, q.y)}-${Math.max(p.y, q.y)}` : `h${p.y}:${Math.min(p.x, q.x)}-${Math.max(p.x, q.x)}`);
      }
    }
    const overlap = (s: string, t: string) => {
      const [ls, rs] = s.split(':');
      const [lt, rt] = t.split(':');
      if (ls !== lt) return false;
      const [a0, a1] = rs.split('-').map(Number);
      const [b0, b1] = rt.split('-').map(Number);
      return Math.min(a1, b1) - Math.max(a0, b0) > 15;
    };
    for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) expect(overlap(lines[i], lines[j])).toBe(false);
  });

  it('never runs through a resource that is not one of its ends, in every template', () => {
    for (const t of TEMPLATES) {
      const graph = t.build(region);
      const nodes = routerNodes(graph.nodes);
      const edges = resolveEdges(graph)
        .filter((r) => r.kind && !r.problem)
        .map((r) => ({ id: r.edge.id, source: r.edge.source, target: r.edge.target }));
      const routes = routeEdges(nodes, edges);
      expect(routes.size).toBe(edges.length);
      for (const e of edges) {
        for (const [p, q] of segments(routes.get(e.id)!)) {
          for (const n of nodes.filter((x) => !x.container && x.id !== e.source && x.id !== e.target)) {
            expect(hits(p, q, n.rect), `${t.id}: ${e.id} crosses ${n.id}`).toBe(false);
          }
        }
      }
    }
  });

  it('builds a rounded path and finds a label spot', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }];
    expect(pathFromPoints(pts)).toContain('Q 100 0');
    expect(labelPoint(pts)).toEqual({ x: 50, y: 0 });
  });
});

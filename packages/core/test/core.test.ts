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
  validateGraph,
  type GraphNode,
} from '../src';

const region = 'us-east-1';

function build() {
  let nodes: GraphNode[] = [];
  const vpc = addNode(nodes, 'vpc', { region, position: { x: 0, y: 0 } });
  nodes = vpc.nodes;
  const s1 = addNode(nodes, 'subnet', { region, parentId: vpc.node.id });
  nodes = s1.nodes;
  const s2 = addNode(nodes, 'subnet', { region, parentId: vpc.node.id });
  nodes = s2.nodes;
  return { nodes, vpc: vpc.node, s1: s1.node, s2: s2.node };
}

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

function edge(source: string, target: string, props?: Record<string, string>) {
  return { id: `${source}-${target}`, source, target, props };
}

/** vpc: 2 public subnets (a, b) + 1 private (c); igw, rt, alb in vpc; ec2 in a; rds in c; s3 free. */
function scenario() {
  let { nodes, vpc, s1, s2 } = build();
  nodes = nodes.map((n) => (n.id === s1.id || n.id === s2.id ? { ...n, props: { ...n.props, public: true } } : n));
  const s3sub = addNode(nodes, 'subnet', { region, parentId: vpc.id });
  nodes = s3sub.nodes;
  const add = (type: Parameters<typeof addNode>[1], parentId?: string) => {
    const r = addNode(nodes, type, { region, parentId });
    nodes = r.nodes;
    return r.node;
  };
  const igw = add('igw', vpc.id);
  const rt = add('route_table', vpc.id);
  const alb = add('alb', vpc.id);
  const ec2 = add('ec2', s1.id);
  const rds = add('rds', s3sub.node.id);
  const bucket = add('s3');
  return { nodes, vpc, s1, s2, priv: s3sub.node, igw, rt, alb, ec2, rds, bucket };
}

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

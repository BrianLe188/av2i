import { addNode, serializeRules, type GraphNode, type SgRule } from '../src';

export const region = 'us-east-1';

export function build() {
  let nodes: GraphNode[] = [];
  const vpc = addNode(nodes, 'vpc', { region, position: { x: 0, y: 0 } });
  nodes = vpc.nodes;
  const s1 = addNode(nodes, 'subnet', { region, parentId: vpc.node.id });
  nodes = s1.nodes;
  const s2 = addNode(nodes, 'subnet', { region, parentId: vpc.node.id });
  nodes = s2.nodes;
  return { nodes, vpc: vpc.node, s1: s1.node, s2: s2.node };
}

export function edge(source: string, target: string, props?: Record<string, string>) {
  return { id: `${source}-${target}`, source, target, props };
}

/** vpc: 2 public subnets (a, b) + 1 private (c); igw, rt, alb in vpc; ec2 in a; rds in c; s3 free. */
export function scenario() {
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


/** A complete rule from a partial one: tcp from anywhere unless said otherwise. */
export const rule = (r: Partial<SgRule> = {}): SgRule => ({ protocol: 'tcp', ports: '', peer: '0.0.0.0/0', description: '', ...r });

/** Node props holding these inbound rules. */
export const ingressProps = (...rules: Partial<SgRule>[]) => ({ ingress_rules: serializeRules(rules.map(rule)) });

/** Adds a security group to `nodes` inside `vpcId`, with the given inbound rules and name. */
export function addSg(nodes: GraphNode[], vpcId: string, name: string, rules: Partial<SgRule>[] = [], extra: Record<string, string | number | boolean> = {}) {
  const r = addNode(nodes, 'sg', { region, parentId: vpcId });
  const sg = { ...r.node, name, props: { ...r.node.props, ...ingressProps(...rules), ...extra } };
  return { sg, nodes: r.nodes.map((n) => (n.id === sg.id ? sg : n)) };
}

import { addNode, autoResize } from './graph';
import { serializeRules } from './sg-rules';
import type { Graph, GraphEdge, GraphNode, ResourceType } from './types';

export interface Template {
  id: string;
  name: string;
  description: string;
  build(region: string): Graph;
}

/** Small helper so templates read as a list of "put this inside that". */
function builder(region: string) {
  let nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const add = (type: ResourceType, opts: { parent?: GraphNode; name?: string; props?: Record<string, string | number | boolean>; at?: [number, number] } = {}) => {
    const position = opts.at && { x: opts.at[0], y: opts.at[1] };
    const r = addNode(nodes, type, { region, parentId: opts.parent?.id, position });
    nodes = r.nodes;
    const node = { ...r.node, name: opts.name ?? r.node.name, props: { ...r.node.props, ...opts.props } };
    nodes = nodes.map((n) => (n.id === node.id ? node : n));
    return node;
  };
  const connect = (a: GraphNode, b: GraphNode, props?: Record<string, string>) =>
    edges.push({ id: `${a.id}-${b.id}`, source: a.id, target: b.id, props });
  const finish = (): Graph => {
    const containers = nodes.filter((n) => n.type === 'vpc' || n.type === 'subnet').map((n) => n.id);
    return { nodes: autoResize(nodes, { fit: containers }), edges };
  };
  return { add, connect, finish };
}

export const TEMPLATES: Template[] = [
  {
    id: 'web-3tier',
    name: 'Web app (3 tiers)',
    description: 'Load balancer in front of two app servers in public subnets and a database in private subnets, with three shared security groups and an S3 bucket the app can read and write.',
    build(region) {
      const b = builder(region);
      const vpc = b.add('vpc', { name: 'main' });
      const pubA = b.add('subnet', { parent: vpc, name: 'public-a', at: [20, 44], props: { public: true } });
      const pubB = b.add('subnet', { parent: vpc, name: 'public-b', at: [340, 44], props: { public: true } });
      const privA = b.add('subnet', { parent: vpc, name: 'private-a', at: [20, 250] });
      const privB = b.add('subnet', { parent: vpc, name: 'private-b', at: [340, 250] });
      const igw = b.add('igw', { parent: vpc, at: [20, 460] });
      const rt = b.add('route_table', { parent: vpc, name: 'public', at: [200, 460] });
      const alb = b.add('alb', { parent: vpc, name: 'web', at: [380, 460] });
      const app = b.add('ec2', { parent: pubA, name: 'app' });
      const app2 = b.add('ec2', { parent: pubB, name: 'app-2' });
      const db = b.add('rds', { parent: privA, name: 'db' });
      const bucket = b.add('s3', { name: 'assets' });
      // Three security groups for the whole stack: the load balancer's, one shared by both app servers, and the database's.
      // The load balancer -> app and app -> database rules come from the connections below.
      const webSg = b.add('sg', { parent: vpc, name: 'web', at: [20, 520], props: { ingress_rules: serializeRules([{ protocol: 'tcp', ports: '80', peer: '0.0.0.0/0', description: 'HTTP from anywhere' }]) } });
      const appSg = b.add('sg', { parent: vpc, name: 'app', at: [200, 520] });
      const dataSg = b.add('sg', { parent: vpc, name: 'data', at: [380, 520], props: { egress_rules: '[]' } });
      // Private subnets reach the internet outbound-only, through a NAT Gateway in a public subnet.
      const nat = b.add('nat', { parent: pubB });
      const privRt = b.add('route_table', { parent: vpc, name: 'private', at: [560, 460] });
      b.connect(nat, privRt);
      b.connect(privRt, privA);
      b.connect(privRt, privB);
      b.connect(igw, rt);
      b.connect(rt, pubA);
      b.connect(rt, pubB);
      b.connect(webSg, alb);
      b.connect(appSg, app);
      b.connect(appSg, app2);
      b.connect(dataSg, db);
      b.connect(alb, app);
      b.connect(alb, app2);
      b.connect(app, db);
      b.connect(app2, db);
      b.connect(app, bucket, { access: 'readwrite' });
      b.connect(app2, bucket, { access: 'readwrite' });
      return b.finish();
    },
  },
  {
    id: 'function-and-database',
    name: 'Function + database',
    description: 'A Lambda function in a private subnet that uses a Postgres database and an S3 bucket (outbound through a NAT Gateway).',
    build(region) {
      const b = builder(region);
      const vpc = b.add('vpc', { name: 'main' });
      const pub = b.add('subnet', { parent: vpc, name: 'public', at: [20, 44], props: { public: true } });
      const privA = b.add('subnet', { parent: vpc, name: 'private-a', at: [340, 44] });
      const privB = b.add('subnet', { parent: vpc, name: 'private-b', at: [340, 250] });
      const igw = b.add('igw', { parent: vpc, at: [20, 250] });
      const pubRt = b.add('route_table', { parent: vpc, name: 'public', at: [20, 340] });
      const privRt = b.add('route_table', { parent: vpc, name: 'private', at: [200, 340] });
      const nat = b.add('nat', { parent: pub });
      const fn = b.add('lambda', { parent: privA, name: 'worker' });
      const db = b.add('rds', { parent: privB, name: 'db' });
      const bucket = b.add('s3', { name: 'data' });
      b.connect(igw, pubRt);
      b.connect(pubRt, pub);
      b.connect(nat, privRt);
      b.connect(privRt, privA);
      b.connect(privRt, privB);
      b.connect(fn, db);
      b.connect(fn, bucket, { access: 'readwrite' });
      return b.finish();
    },
  },
  {
    id: 'container-service',
    name: 'Container service (Fargate)',
    description: 'An ECS Fargate service behind a load balancer in two public subnets, with an internet gateway.',
    build(region) {
      const b = builder(region);
      const vpc = b.add('vpc', { name: 'main' });
      const a = b.add('subnet', { parent: vpc, name: 'public-a', at: [20, 44], props: { public: true } });
      const c = b.add('subnet', { parent: vpc, name: 'public-b', at: [340, 44], props: { public: true } });
      const igw = b.add('igw', { parent: vpc, at: [20, 250] });
      const rt = b.add('route_table', { parent: vpc, name: 'public', at: [200, 250] });
      const alb = b.add('alb', { parent: vpc, name: 'web', at: [380, 250] });
      const svc = b.add('ecs', { parent: a, name: 'web' });
      b.connect(igw, rt);
      b.connect(rt, a);
      b.connect(rt, c);
      b.connect(alb, svc);
      return b.finish();
    },
  },
  {
    id: 'static-site',
    name: 'Static site (S3 + CloudFront)',
    description: 'A private S3 bucket served through a CloudFront distribution over HTTPS.',
    build(region) {
      const b = builder(region);
      const bucket = b.add('s3', { name: 'site' });
      const cdn = b.add('cdn', { name: 'site-cdn' });
      b.connect(cdn, bucket);
      return b.finish();
    },
  },
  {
    id: 'server-and-bucket',
    name: 'Server + bucket',
    description: 'One public EC2 instance with internet access and an S3 bucket it can read and write.',
    build(region) {
      const b = builder(region);
      const vpc = b.add('vpc', { name: 'main' });
      const pub = b.add('subnet', { parent: vpc, name: 'public', props: { public: true } });
      const igw = b.add('igw', { parent: vpc });
      const rt = b.add('route_table', { parent: vpc, name: 'public' });
      const server = b.add('ec2', { parent: pub, name: 'server' });
      const bucket = b.add('s3', { name: 'data' });
      b.connect(igw, rt);
      b.connect(rt, pub);
      b.connect(server, bucket, { access: 'readwrite' });
      return b.finish();
    },
  },
  {
    id: 'network-only',
    name: 'Network only',
    description: 'A VPC with a public and a private subnet and an internet gateway, ready to add servers to.',
    build(region) {
      const b = builder(region);
      const vpc = b.add('vpc', { name: 'main' });
      const pub = b.add('subnet', { parent: vpc, name: 'public', props: { public: true } });
      b.add('subnet', { parent: vpc, name: 'private' });
      const igw = b.add('igw', { parent: vpc });
      const rt = b.add('route_table', { parent: vpc, name: 'public' });
      b.connect(igw, rt);
      b.connect(rt, pub);
      return b.finish();
    },
  },
];

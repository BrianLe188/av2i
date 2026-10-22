import type { Graph, GraphNode } from './types';

/**
 * Rough monthly cost from on-demand list prices (us-east-1, USD, 730 h/month).
 * It covers what the canvas defines (instances, databases, gateways, load balancers, tasks) and
 * lists usage-based services separately instead of guessing their traffic.
 */
const HOURS = 730;
const EC2_HOURLY: Record<string, number> = { 't3.micro': 0.0104, 't3.small': 0.0208, 't3.medium': 0.0416, 'm5.large': 0.096 };
const RDS_HOURLY: Record<string, number> = { 'db.t3.micro': 0.017, 'db.t3.small': 0.034, 'db.t3.medium': 0.068, 'db.m5.large': 0.171 };
const EBS_GB = 0.08;
const RDS_GB = 0.115;
const NAT_HOURLY = 0.045;
const ALB_HOURLY = 0.0225;
const PUBLIC_IPV4_HOURLY = 0.005;
const FARGATE_VCPU_HOURLY = 0.04048;
const FARGATE_GB_HOURLY = 0.004445;

/** Other regions cost more; these are coarse averages, not a price list. */
const REGION_FACTOR: Record<string, number> = {
  'us-east-1': 1,
  'us-west-2': 1,
  'eu-west-1': 1.1,
  'ap-southeast-1': 1.25,
};

export interface CostItem {
  nodeId: string;
  name: string;
  type: GraphNode['type'];
  /** Fixed monthly cost in USD. */
  monthly: number;
  detail: string;
  /** What else will be billed by use, if anything. */
  usage?: string;
}

export interface CostEstimate {
  items: CostItem[];
  total: number;
}

export const formatUsd = (n: number) => `$${n.toFixed(2)}`;

export function estimateCost(graph: Graph, opts: { region: string }): CostEstimate {
  const factor = REGION_FACTOR[opts.region] ?? 1;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const items: CostItem[] = [];
  const add = (n: GraphNode, monthly: number, detail: string, usage?: string) =>
    items.push({ nodeId: n.id, name: n.name, type: n.type, monthly: monthly * factor, detail, usage });
  const ipv4 = PUBLIC_IPV4_HOURLY * HOURS;

  for (const n of graph.nodes) {
    const subnet = byId.get(n.parentId ?? '');
    switch (n.type) {
      case 'ec2': {
        const type = String(n.props.instance_type);
        const volume = (Number(n.props.root_volume_size) || 8) * EBS_GB;
        const hasIp = Boolean(subnet?.props.public);
        add(
          n,
          (EC2_HOURLY[type] ?? 0) * HOURS + volume + (hasIp ? ipv4 : 0),
          `${type}, ${Number(n.props.root_volume_size) || 8} GiB disk${hasIp ? ', public IPv4' : ''}`,
          'Data transfer out',
        );
        break;
      }
      case 'rds': {
        const cls = String(n.props.instance_class);
        const mult = n.props.multi_az ? 2 : 1;
        const storage = (Number(n.props.allocated_storage) || 20) * RDS_GB * mult;
        add(
          n,
          (RDS_HOURLY[cls] ?? 0) * HOURS * mult + storage,
          `${cls}${n.props.multi_az ? ' ×2 (Multi-AZ)' : ''}, ${Number(n.props.allocated_storage) || 20} GiB storage`,
          'Backups beyond the free allowance, data transfer',
        );
        break;
      }
      case 'nat':
        add(n, NAT_HOURLY * HOURS + ipv4, 'NAT Gateway + Elastic IP', '$0.045 per GB processed');
        break;
      case 'alb':
        add(n, ALB_HOURLY * HOURS, 'Application Load Balancer', 'Load balancer capacity units (about $5.84 per LCU-month)');
        break;
      case 'ecs': {
        const tasks = Math.max(0, Number(n.props.desired_count) || 0);
        const vcpu = Number(n.props.cpu) / 1024;
        const gb = Number(n.props.memory) / 1024;
        const hasIp = Boolean(subnet?.props.public);
        const perTask = (vcpu * FARGATE_VCPU_HOURLY + gb * FARGATE_GB_HOURLY) * HOURS + (hasIp ? ipv4 : 0);
        add(n, perTask * tasks, `${tasks} × (${vcpu} vCPU, ${gb} GB${hasIp ? ', public IPv4' : ''})`, 'Log storage, data transfer');
        break;
      }
      case 'lambda':
        add(n, 0, 'No fixed cost', 'Requests and duration (1M requests and 400,000 GB-s a month are free)');
        break;
      case 's3':
        add(n, 0, 'No fixed cost', 'Storage ($0.023 per GB-month) and requests');
        break;
      case 'cdn':
        add(n, 0, 'No fixed cost', 'Requests and data transfer out');
        break;
      case 'dns':
        add(n, 0, 'Record in an existing zone', 'Queries ($0.40 per million)');
        break;
      default:
        break; // VPC, subnets, gateways, route tables and security groups are free
    }
  }

  items.sort((a, b) => b.monthly - a.monthly || a.name.localeCompare(b.name));
  return { items, total: items.reduce((sum, i) => sum + i.monthly, 0) };
}

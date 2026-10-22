import type { PropValue, ResourceType, Size } from './types';

export type ResourceKind = 'container' | 'placed' | 'free';

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  options?: string[];
  default: PropValue;
  hint?: string;
}

export interface ResourceDef {
  type: ResourceType;
  label: string;
  kind: ResourceKind;
  /** Container types this resource may be nested in. Empty = top level. */
  parents: ResourceType[];
  defaultSize: Size;
  minSize: Size;
  fields: FieldDef[];
}

export const REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'];

export const RESOURCES: Record<ResourceType, ResourceDef> = {
  vpc: {
    type: 'vpc',
    label: 'VPC',
    kind: 'container',
    parents: [],
    defaultSize: { width: 460, height: 320 },
    minSize: { width: 300, height: 200 },
    fields: [
      { key: 'cidr_block', label: 'CIDR block', type: 'text', default: '10.0.0.0/16' },
      { key: 'enable_dns_hostnames', label: 'DNS hostnames', type: 'boolean', default: true },
    ],
  },
  subnet: {
    type: 'subnet',
    label: 'Subnet',
    kind: 'container',
    parents: ['vpc'],
    defaultSize: { width: 300, height: 180 },
    minSize: { width: 200, height: 110 },
    fields: [
      { key: 'cidr_block', label: 'CIDR block', type: 'text', default: '10.0.0.0/24' },
      { key: 'availability_zone', label: 'Availability zone', type: 'text', default: '' },
      {
        key: 'public',
        label: 'Public subnet',
        type: 'boolean',
        default: false,
        hint: 'Auto-assign public IPs. Add an IGW + Route Table for a route out.',
      },
    ],
  },
  igw: {
    type: 'igw',
    label: 'Internet gateway',
    kind: 'placed',
    parents: ['vpc'],
    defaultSize: { width: 140, height: 64 },
    minSize: { width: 140, height: 64 },
    fields: [],
  },
  sg: {
    type: 'sg',
    label: 'Security group',
    kind: 'placed',
    parents: ['vpc'],
    defaultSize: { width: 140, height: 64 },
    minSize: { width: 140, height: 64 },
    fields: [
      {
        key: 'ingress_cidr',
        label: 'Allow from CIDR',
        type: 'text',
        default: '',
        hint: 'Source for the ports below, e.g. 0.0.0.0/0 or your office range. Empty = no inbound rule.',
      },
      {
        key: 'ingress_ports',
        label: 'Inbound TCP ports',
        type: 'text',
        default: '',
        hint: 'Comma separated, ranges allowed: 22, 443, 8000-8100',
      },
      { key: 'egress_all', label: 'Allow all outbound', type: 'boolean', default: true },
    ],
  },
  nat: {
    type: 'nat',
    label: 'NAT gateway',
    kind: 'placed',
    parents: ['subnet'],
    defaultSize: { width: 140, height: 64 },
    minSize: { width: 140, height: 64 },
    fields: [],
  },
  route_table: {
    type: 'route_table',
    label: 'Route table',
    kind: 'placed',
    parents: ['vpc'],
    defaultSize: { width: 140, height: 64 },
    minSize: { width: 140, height: 64 },
    fields: [],
  },
  alb: {
    type: 'alb',
    label: 'Load balancer',
    kind: 'placed',
    parents: ['vpc'],
    defaultSize: { width: 140, height: 64 },
    minSize: { width: 140, height: 64 },
    fields: [
      {
        key: 'internal',
        label: 'Internal',
        type: 'boolean',
        default: false,
        hint: 'Off = internet-facing, placed in the VPC\'s public subnets',
      },
      { key: 'listener_port', label: 'Listener port', type: 'number', default: 80 },
      { key: 'target_port', label: 'Target port', type: 'number', default: 80 },
      { key: 'health_check_path', label: 'Health check path', type: 'text', default: '/' },
      {
        key: 'certificate_arn',
        label: 'ACM certificate ARN',
        type: 'text',
        default: '',
        hint: 'Set to serve HTTPS on the listener port (usually 443). The certificate must be in the same region.',
      },
      {
        key: 'redirect_http',
        label: 'Redirect HTTP to HTTPS',
        type: 'boolean',
        default: true,
        hint: 'Adds a port 80 listener that redirects. Only applies with a certificate and a listener port other than 80.',
      },
    ],
  },
  ec2: {
    type: 'ec2',
    label: 'EC2 instance',
    kind: 'placed',
    parents: ['subnet'],
    defaultSize: { width: 140, height: 64 },
    minSize: { width: 140, height: 64 },
    fields: [
      {
        key: 'instance_type',
        label: 'Instance type',
        type: 'select',
        options: ['t3.micro', 't3.small', 't3.medium', 'm5.large'],
        default: 't3.micro',
      },
      { key: 'root_volume_size', label: 'Root volume (GiB)', type: 'number', default: 8 },
      {
        key: 'ami',
        label: 'AMI id',
        type: 'text',
        default: '',
        hint: 'Empty = latest Amazon Linux 2023',
      },
    ],
  },
  lambda: {
    type: 'lambda',
    label: 'Lambda function',
    kind: 'placed',
    parents: ['subnet'],
    defaultSize: { width: 140, height: 64 },
    minSize: { width: 140, height: 64 },
    fields: [
      { key: 'runtime', label: 'Runtime', type: 'select', options: ['python3.12', 'nodejs20.x'], default: 'python3.12' },
      {
        key: 'handler',
        label: 'Handler',
        type: 'text',
        default: 'index.handler',
        hint: 'file.function. A placeholder handler is generated; replace it with your code.',
      },
      { key: 'memory_size', label: 'Memory (MB)', type: 'number', default: 128 },
      { key: 'timeout', label: 'Timeout (s)', type: 'number', default: 10 },
    ],
  },
  ecs: {
    type: 'ecs',
    label: 'ECS service',
    kind: 'placed',
    parents: ['subnet'],
    defaultSize: { width: 140, height: 64 },
    minSize: { width: 140, height: 64 },
    fields: [
      {
        key: 'image',
        label: 'Container image',
        type: 'text',
        default: 'public.ecr.aws/nginx/nginx:latest',
      },
      { key: 'container_port', label: 'Container port', type: 'number', default: 80 },
      { key: 'cpu', label: 'CPU units', type: 'select', options: ['256', '512', '1024', '2048'], default: '256' },
      {
        key: 'memory',
        label: 'Memory (MB)',
        type: 'number',
        default: 512,
        hint: 'Must match the CPU: 256 → 512-2048, 512 → 1024-4096, 1024 → 2048-8192, 2048 → 4096-16384.',
      },
      { key: 'desired_count', label: 'Tasks', type: 'number', default: 1 },
    ],
  },
  rds: {
    type: 'rds',
    label: 'RDS database',
    kind: 'placed',
    parents: ['subnet'],
    defaultSize: { width: 140, height: 64 },
    minSize: { width: 140, height: 64 },
    fields: [
      {
        key: 'engine',
        label: 'Engine',
        type: 'select',
        options: ['postgres', 'mysql', 'mariadb'],
        default: 'postgres',
      },
      {
        key: 'instance_class',
        label: 'Instance class',
        type: 'select',
        options: ['db.t3.micro', 'db.t3.small', 'db.t3.medium', 'db.m5.large'],
        default: 'db.t3.micro',
      },
      { key: 'allocated_storage', label: 'Storage (GiB)', type: 'number', default: 20 },
      { key: 'multi_az', label: 'Multi-AZ', type: 'boolean', default: false },
      { key: 'username', label: 'Master username', type: 'text', default: 'dbadmin' },
    ],
  },
  s3: {
    type: 's3',
    label: 'S3 bucket',
    kind: 'free',
    parents: [],
    defaultSize: { width: 140, height: 64 },
    minSize: { width: 140, height: 64 },
    fields: [
      { key: 'bucket', label: 'Bucket name', type: 'text', default: '' },
      { key: 'versioning', label: 'Versioning', type: 'boolean', default: false },
    ],
  },
  cdn: {
    type: 'cdn',
    label: 'CloudFront',
    kind: 'free',
    parents: [],
    defaultSize: { width: 140, height: 64 },
    minSize: { width: 140, height: 64 },
    fields: [
      {
        key: 'price_class',
        label: 'Price class',
        type: 'select',
        options: ['PriceClass_100', 'PriceClass_200', 'PriceClass_All'],
        default: 'PriceClass_100',
        hint: '100 = North America and Europe only (cheapest).',
      },
      {
        key: 'default_root_object',
        label: 'Default root object',
        type: 'text',
        default: 'index.html',
        hint: 'Served at "/". Only used with an S3 origin.',
      },
      {
        key: 'aliases',
        label: 'Domain aliases',
        type: 'text',
        default: '',
        hint: 'Comma separated, e.g. www.example.com. Needs a certificate.',
      },
      {
        key: 'certificate_arn',
        label: 'ACM certificate ARN',
        type: 'text',
        default: '',
        hint: 'CloudFront only accepts certificates from us-east-1.',
      },
    ],
  },
  dns: {
    type: 'dns',
    label: 'DNS record',
    kind: 'free',
    parents: [],
    defaultSize: { width: 140, height: 64 },
    minSize: { width: 140, height: 64 },
    fields: [
      {
        key: 'zone_name',
        label: 'Hosted zone',
        type: 'text',
        default: 'example.com',
        hint: 'An existing Route 53 public hosted zone, looked up by name.',
      },
      { key: 'record_name', label: 'Record name', type: 'text', default: 'app.example.com' },
    ],
  },
};

export const RESOURCE_ORDER: ResourceType[] = [
  'vpc',
  'subnet',
  'igw',
  'sg',
  'nat',
  'route_table',
  'alb',
  'ec2',
  'lambda',
  'ecs',
  'rds',
  's3',
  'cdn',
  'dns',
];

export function availabilityZones(region: string): string[] {
  return ['a', 'b', 'c'].map((s) => `${region}${s}`);
}

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
};

export const RESOURCE_ORDER: ResourceType[] = [
  'vpc',
  'subnet',
  'igw',
  'nat',
  'route_table',
  'alb',
  'ec2',
  'rds',
  's3',
];

export function availabilityZones(region: string): string[] {
  return ['a', 'b', 'c'].map((s) => `${region}${s}`);
}

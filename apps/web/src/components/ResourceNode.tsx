import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { RESOURCES, sgRules, type GraphNode, type ResourceType } from '@av2i/core';
import { useStore } from '../store';

export const TYPE_COLORS: Record<ResourceType, string> = {
  vpc: '#7c3aed',
  subnet: '#2563eb',
  igw: '#0d9488',
  nat: '#475569',
  sg: '#b91c1c',
  dns: '#0284c7',
  lambda: '#d97706',
  ecs: '#4f46e5',
  cdn: '#7e22ce',
  route_table: '#a16207',
  alb: '#db2777',
  ec2: '#ea580c',
  rds: '#0891b2',
  s3: '#16a34a',
};

const BADGES: Partial<Record<ResourceType, string>> = { route_table: 'RTB', nat: 'NAT', sg: 'SG', dns: 'DNS', lambda: 'FN', ecs: 'ECS', cdn: 'CDN' };

export interface ResourceData extends Record<string, unknown> {
  resource: GraphNode;
  errors: number;
  warnings: number;
}

export type ResourceFlowNode = Node<ResourceData, 'resource'>;

function summary(n: GraphNode): string {
  switch (n.type) {
    case 'vpc':
      return String(n.props.cidr_block);
    case 'subnet':
      return `${n.props.cidr_block} · ${String(n.props.availability_zone).slice(-2) || '—'}${n.props.public ? ' · public' : ''}`;
    case 'igw':
      return 'internet gateway';
    case 'sg':
      return `${sgRules(n, 'ingress').length} in · ${sgRules(n, 'egress').length} out`;
    case 'nat':
      return 'outbound only';
    case 'route_table':
      return 'routes';
    case 'alb':
      return `${n.props.internal ? 'internal' : 'public'} · ${String(n.props.certificate_arn ?? '').trim() ? 'https' : 'http'} :${n.props.listener_port}`;
    case 'ec2':
      return String(n.props.instance_type);
    case 'rds':
      return `${n.props.engine} · ${n.props.instance_class}`;
    case 'lambda':
      return `${n.props.runtime} · ${n.props.memory_size} MB`;
    case 'ecs':
      return `${n.props.desired_count}× · ${n.props.cpu}/${n.props.memory}`;
    case 'cdn':
      return String(n.props.aliases).trim() || 'CloudFront';
    case 'dns':
      return String(n.props.record_name);
    case 's3':
      return String(n.props.bucket);
  }
}

export function ResourceNode({ data, selected }: NodeProps<ResourceFlowNode>) {
  const { resource, errors, warnings } = data;
  const def = RESOURCES[resource.type];
  const color = TYPE_COLORS[resource.type];
  const isContainer = def.kind === 'container';
  const beginChange = useStore((s) => s.beginChange);
  const setSize = useStore((s) => s.setSize);
  const finishResize = useStore((s) => s.finishResize);

  return (
    <div
      className={`rnode ${isContainer ? 'container' : 'leaf'} ${selected ? 'selected' : ''} ${errors ? 'has-error' : ''}`}
      style={{ width: resource.size.width, height: resource.size.height, ['--c' as string]: color }}
    >
      {isContainer && (
        <NodeResizer
          isVisible={selected}
          minWidth={def.minSize.width}
          minHeight={def.minSize.height}
          onResizeStart={() => beginChange()}
          onResize={(_, p) => setSize(resource.id, { width: p.width, height: p.height })}
          onResizeEnd={finishResize}
        />
      )}
      <div className="rnode-head">
        <span className="badge">{BADGES[resource.type] ?? resource.type.toUpperCase()}</span>
        <span className="rnode-name">{resource.name}</span>
        {(errors > 0 || warnings > 0) && (
          <span className={errors ? 'pill error' : 'pill warning'} title={`${errors} errors, ${warnings} warnings`}>
            {errors || warnings}
          </span>
        )}
      </div>
      <div className="rnode-sub">{summary(resource)}</div>
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Left} />
    </div>
  );
}

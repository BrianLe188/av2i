export type ResourceType = 'vpc' | 'subnet' | 'igw' | 'route_table' | 'alb' | 'ec2' | 'rds' | 's3';

export type PropValue = string | number | boolean;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface GraphNode {
  id: string;
  type: ResourceType;
  name: string;
  /** Relative to the parent node when `parentId` is set, absolute otherwise. */
  position: Point;
  size: Size;
  parentId?: string;
  props: Record<string, PropValue>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Connection settings, e.g. `access` on an EC2-S3 edge. */
  props?: Record<string, PropValue>;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type Severity = 'error' | 'warning';

export interface Issue {
  /** Node the issue belongs to; for edge issues, the edge's source node. */
  nodeId: string;
  edgeId?: string;
  severity: Severity;
  message: string;
}

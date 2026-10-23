import type { MechanismId, RuleId, ServiceId } from "@av2i/registry";

export type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
export type Props = Record<string, Value>;

export interface Node {
  /** immutable; becomes the Terraform local name (DD-011) */
  key: string;
  /** free text; changing it has no side effect */
  label: string;
  service: ServiceId;
  /** key of the containing node */
  parent?: string | null;
  props: Props;
  position?: { x: number; y: number };
}

export interface Edge {
  id: string;
  mechanism: MechanismId;
  from: string;
  to: string;
  props?: Props;
}

export interface Design {
  schema: 1;
  name: string;
  settings: { region: string };
  nodes: Node[];
  edges: Edge[];
}

export type Origin = "user" | "derived" | "generated";

export interface NormalizedNode extends Node {
  origin: Origin;
  because?: string;
}

export interface NormalizedEdge extends Edge {
  origin: Origin;
  because?: string;
}

export interface NormalizedDesign {
  name: string;
  settings: Design["settings"];
  nodes: NormalizedNode[];
  edges: NormalizedEdge[];
}

export type Severity = "error" | "warning" | "info";

export interface Finding {
  rule: RuleId;
  severity: Severity;
  targets: string[];
  message: { vi: string; en: string };
  fix: { vi: string; en: string };
}

export type PatchOp =
  | { op: "set"; node: string; path: string; value: Value }
  | { op: "unset"; node: string; path: string }
  | { op: "add-node"; node: Node }
  | { op: "remove-node"; key: string }
  | { op: "add-edge"; edge: Edge }
  | { op: "remove-edge"; mechanism: string; from: string; to: string };

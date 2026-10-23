import type { NormalizedDesign, NormalizedEdge, NormalizedNode, Props, Value } from "@av2i/model";

export function getPath(root: unknown, path: string): Value | undefined {
  let cur: any = root;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur as Value | undefined;
}

export interface Route {
  edge: NormalizedEdge;
  table: string;
  target: NormalizedNode;
  /** destination CIDR; undefined for an endpoint route, whose destination is the S3 prefix list */
  destination: string | undefined;
}

/** Read-only queries over a normalized design. Rules and the planner use these and never walk arrays themselves. */
export class Graph {
  readonly design: NormalizedDesign;
  readonly nodes: Map<string, NormalizedNode>;

  constructor(design: NormalizedDesign) {
    this.design = design;
    this.nodes = new Map(design.nodes.map((n) => [n.key, n]));
  }

  node(key: string): NormalizedNode | undefined {
    return this.nodes.get(key);
  }

  nodesOf(service: string): NormalizedNode[] {
    return this.design.nodes.filter((n) => n.service === service);
  }

  edges(mechanism: string): NormalizedEdge[] {
    return this.design.edges.filter((e) => e.mechanism === mechanism);
  }

  prop<T extends Value = Value>(key: string, path: string): T | undefined {
    const n = this.nodes.get(key);
    return n ? (getPath(n.props, path) as T | undefined) : undefined;
  }

  props(key: string): Props {
    return this.nodes.get(key)?.props ?? {};
  }

  parentOf(key: string): NormalizedNode | undefined {
    const p = this.nodes.get(key)?.parent;
    return p ? this.nodes.get(p) : undefined;
  }

  childrenOf(key: string): NormalizedNode[] {
    return this.design.nodes.filter((n) => n.parent === key);
  }

  /** The VPC a node belongs to, walking up through parents. */
  vpcOf(key: string): NormalizedNode | undefined {
    let cur = this.nodes.get(key);
    for (let i = 0; cur && i < 8; i++) {
      if (cur.service === "vpc") return cur;
      cur = cur.parent ? this.nodes.get(cur.parent) : undefined;
    }
    return undefined;
  }

  /** The subnet a node sits in (its parent when that is a subnet). */
  subnetOf(key: string): NormalizedNode | undefined {
    const p = this.parentOf(key);
    return p?.service === "subnet" ? p : undefined;
  }

  /** Route tables explicitly associated with a subnet. A subnet with none uses the VPC's main route table. */
  routeTablesOf(subnet: string): NormalizedNode[] {
    return this.edges("route-association")
      .filter((e) => e.to === subnet || e.from === subnet)
      .map((e) => this.nodes.get(e.from === subnet ? e.to : e.from))
      .filter((n): n is NormalizedNode => !!n && n.service === "route-table");
  }

  routesOf(table: string): Route[] {
    const out: Route[] = [];
    for (const e of this.edges("route")) {
      if (e.from !== table) continue;
      const target = this.nodes.get(e.to);
      if (!target) continue;
      const dest = e.props?.destination_cidr_block;
      out.push({ edge: e, table, target, destination: typeof dest === "string" ? dest : target.service === "vpc-endpoint-s3" ? undefined : "0.0.0.0/0" });
    }
    return out;
  }

  /** Security groups attached to a node, in the order of the design. */
  securityGroupsOf(key: string): NormalizedNode[] {
    return this.edges("sg-attach")
      .filter((e) => e.to === key || e.from === key)
      .map((e) => this.nodes.get(e.from === key ? e.to : e.from))
      .filter((n): n is NormalizedNode => !!n && n.service === "security-group");
  }

  /** Elastic IPs connected to a node. */
  elasticIpsOf(key: string): NormalizedNode[] {
    return this.edges("eip-attach")
      .filter((e) => e.to === key)
      .map((e) => this.nodes.get(e.from))
      .filter((n): n is NormalizedNode => !!n);
  }
}

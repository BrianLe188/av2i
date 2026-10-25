import type { NormalizedDesign, NormalizedEdge, NormalizedNode, Props, Value } from "@av2i/model";
import { slotOfEdge, type SlotId } from "./roles.ts";

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

  /**
   * Subnets a workload spans: its parent plus any subnet connected by a containment edge, and for a database the
   * subnets of the DB subnet group it is drawn to. In design order, without repeats.
   */
  subnetsOf(key: string): NormalizedNode[] {
    const out: NormalizedNode[] = [];
    const add = (n: NormalizedNode | undefined) => { if (n && n.service === "subnet" && !out.includes(n)) out.push(n); };
    add(this.subnetOf(key));
    for (const e of this.design.edges) {
      if (e.mechanism === "containment" && e.to === key) add(this.nodes.get(e.from));
      if (e.mechanism === "db-subnet-group" && e.from === key) for (const s of this.subnetsOf(e.to)) add(s);
    }
    return out;
  }

  /** The DB subnet group a database is drawn to. */
  dbSubnetGroupOf(db: string): NormalizedNode | undefined {
    const e = this.edges("db-subnet-group").find((x) => x.from === db);
    const n = e ? this.nodes.get(e.to) : undefined;
    return n?.service === "db-subnet-group" ? n : undefined;
  }

  /** Roles a consumer runs as, with the slot each fills (assume-role edges run from the role to the consumer). */
  rolesOf(consumer: string): { role: NormalizedNode; slot: SlotId | undefined; edge: NormalizedEdge }[] {
    const c = this.nodes.get(consumer);
    if (!c) return [];
    return this.edges("assume-role")
      .filter((e) => e.to === consumer)
      .flatMap((e) => {
        const role = this.nodes.get(e.from);
        return role ? [{ role, slot: slotOfEdge(c.service, e.props), edge: e }] : [];
      });
  }

  /** Consumers that run as a role, with the slot each uses. */
  consumersOf(role: string): { consumer: NormalizedNode; slot: SlotId | undefined; edge: NormalizedEdge }[] {
    return this.edges("assume-role")
      .filter((e) => e.from === role)
      .flatMap((e) => {
        const consumer = this.nodes.get(e.to);
        return consumer ? [{ consumer, slot: slotOfEdge(consumer.service, e.props), edge: e }] : [];
      });
  }

  /** The ECR repository connected to a consumer through image-source. */
  imageOf(consumer: string): NormalizedNode | undefined {
    const e = this.edges("image-source").find((x) => x.to === consumer);
    return e ? this.nodes.get(e.from) : undefined;
  }

  /** Elastic IPs connected to a node. */
  elasticIpsOf(key: string): NormalizedNode[] {
    return this.edges("eip-attach")
      .filter((e) => e.to === key)
      .map((e) => this.nodes.get(e.from))
      .filter((n): n is NormalizedNode => !!n);
  }
}

import type { Props, Value } from "@av2i/model";
import { Graph } from "./graph.ts";
import { computeFacts } from "./facts.ts";

export interface SgRule {
  ip_protocol: string;
  from_port?: number;
  to_port?: number;
  cidr_ipv4?: string;
  cidr_ipv6?: string;
  prefix_list_id?: string;
  /** key of an S3 endpoint whose prefix list is the peer (generated rule) */
  prefix_list_of?: string;
  referenced_security_group_id?: string;
  description?: string;
  /** set on rules the engine added */
  generated?: "default-egress" | "s3-endpoint" | "network-access";
}

const asRules = (v: Value | undefined): SgRule[] => (Array.isArray(v) ? (v as unknown as SgRule[]) : []);

export function ingressRules(props: Props): SgRule[] {
  return asRules(props.ingress_rules);
}

/** The port a callee listens on: a database's configured or engine port, a service's container port. */
export function servicePort(g: Graph, key: string): number | undefined {
  const n = g.node(key);
  if (!n) return undefined;
  if (n.service === "rds") return typeof n.props.port === "number" ? n.props.port : n.props.engine === "mysql" ? 3306 : 5432;
  if (n.service === "ecs") return typeof n.props.container_port === "number" ? n.props.container_port : undefined;
  return undefined;
}

export interface Access {
  edge: string;
  callerSg: string;
  calleeSg: string;
  port: number;
  /** the port of the callee itself; differs from `port` when the connection overrides it (VAL-068) */
  calleePort: number | undefined;
}

/**
 * What each network-access connection turns into (decision D-012): the group on a side is the only one it has, else the
 * one the connection names in `caller_sg` or `callee_sg`. A connection with no resolvable group or port yields nothing.
 */
export function accesses(g: Graph): Access[] {
  const out: Access[] = [];
  const pick = (node: string, named: unknown): string | undefined => {
    const groups = g.securityGroupsOf(node).map((s) => s.key);
    if (typeof named === "string" && groups.includes(named)) return named;
    return groups.length === 1 ? groups[0] : undefined;
  };
  for (const e of g.edges("network-access")) {
    const callerSg = pick(e.from, e.props?.caller_sg);
    const calleeSg = pick(e.to, e.props?.callee_sg);
    const calleePort = servicePort(g, e.to);
    const port = typeof e.props?.port === "number" ? e.props.port : calleePort;
    if (callerSg && calleeSg && port !== undefined) out.push({ edge: e.id, callerSg, calleeSg, port, calleePort });
  }
  return out;
}

/** Ingress rules of a group as they will be emitted: the ones written on it, then one per connection that reaches it. */
export function effectiveIngress(g: Graph, sgKey: string): SgRule[] {
  const rules = ingressRules(g.props(sgKey)).map((r) => ({ ...r }));
  for (const a of accesses(g)) {
    if (a.calleeSg !== sgKey) continue;
    if (rules.some((r) => r.referenced_security_group_id === a.callerSg && r.from_port === a.port && r.to_port === a.port && r.ip_protocol === "tcp")) continue;
    rules.push({ ip_protocol: "tcp", from_port: a.port, to_port: a.port, referenced_security_group_id: a.callerSg, description: `from ${a.callerSg}`, generated: "network-access" });
  }
  return rules;
}

const allowsAll = (r: SgRule) => r.ip_protocol === "-1" && (r.cidr_ipv4 === "0.0.0.0/0" || r.cidr_ipv6 === "::/0");

/**
 * Egress rules of a security group as they will be emitted. An absent `egress_rules` means AWS's allow-all rule (DD-013);
 * an explicit list is kept as written. When the group restricts egress and a workload that uses it reaches S3 through
 * an endpoint, a rule to the S3 prefix list on port 443 is added (VAL-127, route mechanism).
 */
export function effectiveEgress(g: Graph, sgKey: string): SgRule[] {
  const props = g.props(sgKey);
  const explicit = props.egress_rules;
  const rules: SgRule[] = explicit === undefined
    ? [{ ip_protocol: "-1", cidr_ipv4: "0.0.0.0/0", generated: "default-egress" }]
    : asRules(explicit).map((r) => ({ ...r }));
  if (rules.some(allowsAll)) return rules;
  // a group that restricts egress needs a rule toward the group of every callee it reaches
  for (const a of accesses(g)) {
    if (a.callerSg !== sgKey) continue;
    if (rules.some((r) => r.referenced_security_group_id === a.calleeSg && r.from_port === a.port && r.to_port === a.port)) continue;
    rules.push({ ip_protocol: "tcp", from_port: a.port, to_port: a.port, referenced_security_group_id: a.calleeSg, description: `to ${a.calleeSg}`, generated: "network-access" });
  }
  const facts = computeFacts(g);
  const endpoints = new Set<string>();
  for (const e of g.edges("sg-attach")) {
    const workload = e.from === sgKey ? e.to : e.to === sgKey ? e.from : null;
    const ep = workload ? facts.workloads.get(workload)?.s3Endpoint : null;
    if (ep) endpoints.add(ep);
  }
  for (const ep of [...endpoints].sort()) {
    if (rules.some((r) => r.prefix_list_of === ep && r.from_port === 443)) continue;
    rules.push({ ip_protocol: "tcp", from_port: 443, to_port: 443, prefix_list_of: ep, description: "S3 through the gateway endpoint", generated: "s3-endpoint" });
  }
  return rules;
}

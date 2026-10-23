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
  generated?: "default-egress" | "s3-endpoint";
}

const asRules = (v: Value | undefined): SgRule[] => (Array.isArray(v) ? (v as unknown as SgRule[]) : []);

export function ingressRules(props: Props): SgRule[] {
  return asRules(props.ingress_rules);
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

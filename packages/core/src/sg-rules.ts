import { parsePorts } from './ports';
import type { GraphNode, PropValue } from './types';

export const SG_PROTOCOLS = ['tcp', 'udp', 'icmp', 'all'] as const;
export type SgProtocol = (typeof SG_PROTOCOLS)[number];

/** One inbound or outbound rule. For outbound rules `peer` is the destination. */
export interface SgRule {
  protocol: SgProtocol;
  /** tcp/udp only: "22, 443, 8000-8100". Empty = every port. */
  ports: string;
  /** An IPv4 CIDR, or `sg:<node id>` for another security group on the canvas. */
  peer: string;
  description: string;
}

export type SgDirection = 'ingress' | 'egress';

export const WORLD = '0.0.0.0/0';
export const SG_PEER_PREFIX = 'sg:';

export const peerOfSg = (id: string) => `${SG_PEER_PREFIX}${id}`;
export const sgIdOfPeer = (peer: string): string | undefined =>
  peer.startsWith(SG_PEER_PREFIX) ? peer.slice(SG_PEER_PREFIX.length) : undefined;

export const ALLOW_ALL_EGRESS: SgRule = { protocol: 'all', ports: '', peer: WORLD, description: '' };

export const newRule = (direction: SgDirection): SgRule => ({
  protocol: 'tcp',
  ports: direction === 'ingress' ? '443' : '',
  peer: WORLD,
  description: '',
});

/** Rules live in a node's props as JSON text, so they travel with the graph like any other property. */
export function serializeRules(rules: SgRule[]): string {
  return JSON.stringify(rules);
}

export function parseRules(value: PropValue | undefined): SgRule[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const raw: unknown = JSON.parse(value);
    if (!Array.isArray(raw)) return [];
    return raw.map((r: Partial<SgRule>) => ({
      protocol: SG_PROTOCOLS.includes(r.protocol as SgProtocol) ? (r.protocol as SgProtocol) : 'tcp',
      ports: String(r.ports ?? ''),
      peer: String(r.peer ?? ''),
      description: String(r.description ?? ''),
    }));
  } catch {
    return [];
  }
}

export const DEFAULT_INGRESS_RULES = serializeRules([]);
export const DEFAULT_EGRESS_RULES = serializeRules([ALLOW_ALL_EGRESS]);

/**
 * The rules of a security group node. Groups saved before rule lists existed carry the old single-rule
 * props (`ingress_cidr`, `ingress_ports`, `egress_all`); they are read as the equivalent rules.
 */
export function sgRules(node: GraphNode, direction: SgDirection): SgRule[] {
  const key = direction === 'ingress' ? 'ingress_rules' : 'egress_rules';
  if (node.props[key] !== undefined) return parseRules(node.props[key]);
  if (direction === 'egress') return node.props.egress_all === false ? [] : [ALLOW_ALL_EGRESS];
  const cidr = String(node.props.ingress_cidr ?? '').trim();
  const ports = String(node.props.ingress_ports ?? '').trim();
  return cidr && ports ? [{ protocol: 'tcp', ports, peer: cidr, description: '' }] : [];
}

export interface RuleSegment {
  /** Value for Terraform's `ip_protocol`. */
  protocol: 'tcp' | 'udp' | 'icmp' | '-1';
  /** Undefined for "all traffic", where AWS takes no ports. */
  from?: number;
  to?: number;
}

/** Terraform takes one port range per rule resource, so a list like "22, 8000-8100" becomes several segments. Null when the ports are malformed. */
export function expandRule(rule: SgRule): RuleSegment[] | null {
  if (rule.protocol === 'all') return [{ protocol: '-1' }];
  if (rule.protocol === 'icmp') return [{ protocol: 'icmp', from: -1, to: -1 }];
  const ranges = parsePorts(rule.ports);
  if (!ranges) return null;
  if (ranges.length === 0) return [{ protocol: rule.protocol, from: 0, to: 65535 }];
  return ranges.map((r) => ({ protocol: rule.protocol as 'tcp' | 'udp', from: r.from, to: r.to }));
}

/** Short text for a rule, e.g. "TCP 443", "All traffic". */
export function describeRule(rule: SgRule): string {
  if (rule.protocol === 'all') return 'All traffic';
  if (rule.protocol === 'icmp') return 'ICMP';
  return `${rule.protocol.toUpperCase()} ${rule.ports.trim() || 'all ports'}`;
}

function mapRules(node: GraphNode, fn: (rules: SgRule[]) => SgRule[]): GraphNode {
  const props = { ...node.props };
  for (const key of ['ingress_rules', 'egress_rules'] as const) {
    if (props[key] !== undefined) props[key] = serializeRules(fn(parseRules(props[key])));
  }
  return { ...node, props };
}

/** After nodes are deleted: drop rules that point at them and clear a VPC default group that is gone. */
export function stripReferences(node: GraphNode, gone: Set<string>): GraphNode {
  if (node.type === 'sg') {
    return mapRules(node, (rules) => rules.filter((r) => !gone.has(sgIdOfPeer(r.peer) ?? '')));
  }
  if (node.type === 'vpc' && gone.has(String(node.props.default_sg ?? ''))) {
    return { ...node, props: { ...node.props, default_sg: '' } };
  }
  return node;
}

/** After nodes are copied: point references inside the copy at the copied nodes. */
export function remapReferences(node: GraphNode, idMap: Map<string, string>): GraphNode {
  if (node.type === 'sg') {
    return mapRules(node, (rules) =>
      rules.map((r) => {
        const target = idMap.get(sgIdOfPeer(r.peer) ?? '');
        return target ? { ...r, peer: peerOfSg(target) } : r;
      }),
    );
  }
  if (node.type === 'vpc') {
    const target = idMap.get(String(node.props.default_sg ?? ''));
    if (target) return { ...node, props: { ...node.props, default_sg: target } };
  }
  return node;
}

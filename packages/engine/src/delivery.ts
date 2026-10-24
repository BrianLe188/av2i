import type { NormalizedEdge, NormalizedNode, Value } from "@av2i/model";
import { Graph } from "./graph.ts";
import { servicePort } from "./sg.ts";

export type TargetType = "instance" | "ip" | "lambda";

export interface TargetGroup {
  /** local name of the generated resource: the connection's `target_group`, else built from the ALB and the target */
  id: string;
  alb: string;
  edges: NormalizedEdge[];
  targets: NormalizedNode[];
  type: TargetType;
  port: number | undefined;
  protocol: string;
}

const DEFAULT_TYPE: Record<string, TargetType> = { ec2: "instance", ecs: "ip", lambda: "lambda" };

const obj = (v: Value | undefined): Record<string, Value> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Value>) : {});

/**
 * The target groups of a design (decision DD-017). Each listener-target connection makes one, unless connections name the
 * same `target_group`, which then share it. The type follows the target (instance, ip for a Fargate service, lambda) unless
 * the connection says otherwise, so a wrong type is a visible mistake (VAL-043, VAL-079).
 */
export function targetGroupsOf(g: Graph): TargetGroup[] {
  const groups = new Map<string, TargetGroup>();
  for (const e of g.edges("listener-target")) {
    const target = g.node(e.to);
    if (!target) continue;
    const named = e.props?.target_group;
    const id = typeof named === "string" && named ? named : `${e.from}_${e.to}`;
    const declared = e.props?.target_type;
    const type = declared === "instance" || declared === "ip" || declared === "lambda" ? declared : (DEFAULT_TYPE[target.service] ?? "ip");
    const port = typeof e.props?.port === "number" ? e.props.port : servicePort(g, target.key);
    const protocol = typeof e.props?.protocol === "string" ? e.props.protocol : "HTTP";
    const had = groups.get(id);
    if (had) { had.edges.push(e); had.targets.push(target); continue; }
    groups.set(id, { id, alb: e.from, edges: [e], targets: [target], type, port, protocol });
  }
  return [...groups.values()];
}

export interface Listener {
  port: number;
  protocol: string;
  ssl_policy: string | undefined;
  action: { type: string; target?: string; status_code?: string; port?: string; protocol?: string; content_type?: string; message_body?: string };
}

/** The listeners written on an ALB node, in order. Anything that is not an object with a port is dropped here and reported by VAL-076. */
export function listenersOf(g: Graph, alb: string): Listener[] {
  const raw = g.prop(alb, "listeners");
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((l) => {
    const o = obj(l as Value);
    const a = obj(o.default_action);
    const text = (v: Value | undefined) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
    return [{
      port: typeof o.port === "number" ? o.port : NaN,
      protocol: typeof o.protocol === "string" ? o.protocol : "HTTP",
      ssl_policy: typeof o.ssl_policy === "string" ? o.ssl_policy : undefined,
      action: { type: typeof a.type === "string" ? a.type : "forward", target: text(a.target), status_code: text(a.status_code), port: text(a.port), protocol: text(a.protocol), content_type: text(a.content_type), message_body: text(a.message_body) },
    }];
  });
}

/** The target groups a forward action sends to: the ones holding the named target, else every group of the ALB. */
export function forwardsOf(g: Graph, alb: string, l: Listener): TargetGroup[] {
  const mine = targetGroupsOf(g).filter((t) => t.alb === alb);
  return l.action.target ? mine.filter((t) => t.targets.some((x) => x.key === l.action.target)) : mine;
}

/** The hosted zone whose name is the longest suffix of a domain (a wildcard name is read without its `*.`). */
export function zoneFor(g: Graph, domain: string): NormalizedNode | undefined {
  const name = domain.replace(/^\*\./, "").toLowerCase();
  let best: NormalizedNode | undefined;
  for (const z of g.nodesOf("route53")) {
    const zn = typeof z.props.name === "string" ? z.props.name.toLowerCase().replace(/\.$/, "") : "";
    if (zn && (name === zn || name.endsWith(`.${zn}`)) && (!best || zn.length > String(best.props.name).length)) best = z;
  }
  return best;
}

/** Every name an ACM certificate covers. */
export function certNames(cert: NormalizedNode): string[] {
  const sans = Array.isArray(cert.props.subject_alternative_names) ? (cert.props.subject_alternative_names as unknown[]).map(String) : [];
  return [...(typeof cert.props.domain_name === "string" ? [cert.props.domain_name] : []), ...sans];
}

/** Does a certificate name cover a served name: an exact match, or a wildcard at the same level (`*.example.com` covers `www.example.com`). */
export function covers(certName: string, served: string): boolean {
  const c = certName.toLowerCase();
  const s = served.toLowerCase();
  if (c === s) return true;
  if (!c.startsWith("*.")) return false;
  const rest = c.slice(1);
  return s.endsWith(rest) && !s.slice(0, s.length - rest.length).includes(".") && s.length > rest.length;
}

export const certRegion = (g: Graph, cert: NormalizedNode): string => (typeof cert.props.region === "string" && cert.props.region ? cert.props.region : g.design.settings.region);

/** The certificate connected to a load balancer or a distribution. */
export function certOf(g: Graph, consumer: string): NormalizedNode | undefined {
  const e = g.edges("cert-attach").find((x) => x.to === consumer);
  return e ? g.node(e.from) : undefined;
}

export interface Origin {
  edge: NormalizedEdge;
  node: NormalizedNode;
  /** the id used inside the distribution */
  id: string;
}

/** The origins of a distribution, in the order of the design; the first is the default unless one is marked `default`. */
export function originsOf(g: Graph, cdn: string): Origin[] {
  return g.edges("origin").filter((e) => e.from === cdn).flatMap((e) => {
    const node = g.node(e.to);
    return node ? [{ edge: e, node, id: node.key }] : [];
  });
}

export const defaultOrigin = (origins: Origin[]): Origin | undefined => origins.find((o) => o.edge.props?.default === true) ?? origins[0];

export const aliasesOf = (cdn: NormalizedNode): string[] => (Array.isArray(cdn.props.aliases) ? (cdn.props.aliases as unknown[]).map(String) : []);

/** The names a dns-alias connection makes records for: the distribution's aliases that sit in the zone, or the connection's `name` for a load balancer. */
export function aliasRecords(g: Graph, edge: NormalizedEdge): { name: string; target: NormalizedNode }[] {
  const zone = g.node(edge.from);
  const target = g.node(edge.to);
  if (!zone || !target) return [];
  const zn = String(zone.props.name ?? "").toLowerCase().replace(/\.$/, "");
  const inZone = (n: string) => n.toLowerCase() === zn || n.toLowerCase().endsWith(`.${zn}`);
  if (target.service === "cloudfront") return aliasesOf(target).filter(inZone).map((name) => ({ name, target }));
  const named = edge.props?.name;
  return [{ name: typeof named === "string" && named ? named : zn, target }];
}

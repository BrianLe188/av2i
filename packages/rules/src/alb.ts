import { certOf, effectiveEgress, effectiveIngress, forwardsOf, listenersOf, targetGroupsOf, type Listener } from "@av2i/engine";
import { parseCidr } from "./cidr.ts";
import { hit, type Ctx, type RuleImpl } from "./context.ts";

const albs = (ctx: Ctx) => ctx.g.nodesOf("alb");
const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const internetFacing = (ctx: Ctx, key: string) => ctx.g.node(key)?.props.internal !== true;

export const VAL_071: RuleImpl = (ctx) =>
  albs(ctx).filter((a) => {
    const subnets = ctx.g.subnetsOf(a.key);
    const zones = new Set(subnets.map((s) => text(s.props.availability_zone)).filter((z): z is string => !!z));
    const vpcs = new Set(subnets.map((s) => ctx.g.vpcOf(s.key)?.key));
    return subnets.length < 2 || zones.size < 2 || vpcs.size > 1;
  }).map((a) => hit(a.key, ...ctx.g.subnetsOf(a.key).map((s) => s.key)));

export const VAL_072: RuleImpl = (ctx) =>
  albs(ctx).filter((a) => ctx.g.subnetsOf(a.key).some((s) => { const c = parseCidr(s.props.cidr_block); return !c || c.prefix > 27; })).map((a) => hit(a.key));

export const VAL_073: RuleImpl = (ctx) => {
  const out = [];
  const seen = new Set<string>();
  for (const a of albs(ctx)) {
    const name = text(a.props.name) ?? a.key.replace(/_/g, "-");
    const bad = name.length > 32 || !/^[A-Za-z0-9-]+$/.test(name) || name.startsWith("-") || name.endsWith("-") || seen.has(name);
    seen.add(name);
    if (bad) out.push(hit(a.key));
  }
  return out;
};

export const VAL_074: RuleImpl = (ctx) =>
  albs(ctx).filter((a) => internetFacing(ctx, a.key) && ctx.g.subnetsOf(a.key).some((s) => !ctx.facts.subnets.get(s.key)?.public)).map((a) => hit(a.key));

export const VAL_075: RuleImpl = (ctx) =>
  albs(ctx).filter((a) => listenersOf(ctx.g, a.key).some((l) => l.protocol === "HTTPS") && !certOf(ctx.g, a.key)).map((a) => hit(a.key));

function badListener(ctx: Ctx, alb: string, l: Listener): boolean {
  if (!Number.isInteger(l.port) || l.port < 1 || l.port > 65535 || (l.protocol !== "HTTP" && l.protocol !== "HTTPS")) return true;
  const a = l.action;
  if (a.type === "redirect") return a.status_code !== undefined && a.status_code !== "HTTP_301" && a.status_code !== "HTTP_302";
  if (a.type === "fixed-response") return a.status_code !== undefined && !/^[245]\d\d$/.test(a.status_code);
  if (a.type !== "forward") return true;
  const n = forwardsOf(ctx.g, alb, l).length;
  return n < 1 || n > 5;
}

export const VAL_076: RuleImpl = (ctx) => albs(ctx).filter((a) => listenersOf(ctx.g, a.key).some((l) => badListener(ctx, a.key, l))).map((a) => hit(a.key));

export const VAL_077: RuleImpl = (ctx) =>
  targetGroupsOf(ctx.g).filter((t) => (t.type === "lambda" ? t.edges.some((e) => e.props?.port !== undefined) : t.port === undefined)).map((t) => hit(t.alb, ...t.targets.map((x) => x.key)));

export const VAL_078: RuleImpl = (ctx) => {
  const sources = new Map<string, Set<string>>();
  for (const e of ctx.g.edges("listener-target")) {
    const id = text(e.props?.target_group);
    if (!id) continue;
    (sources.get(id) ?? sources.set(id, new Set()).get(id)!).add(e.from);
  }
  return [...sources.values()].filter((s) => s.size > 1).map((s) => hit(...s));
};

export const VAL_079: RuleImpl = (ctx) =>
  targetGroupsOf(ctx.g).filter((t) => {
    const kinds = new Set(t.targets.map((x) => x.service));
    if (kinds.size > 1) return true;
    if (t.type === "lambda") return t.targets.length !== 1 || !kinds.has("lambda");
    return kinds.has("lambda");
  }).map((t) => hit(t.alb, ...t.targets.map((x) => x.key)));

export const VAL_043: RuleImpl = (ctx) =>
  targetGroupsOf(ctx.g).filter((t) => t.type !== "ip" && t.targets.some((x) => x.service === "ecs")).map((t) => hit(t.alb, ...t.targets.map((x) => x.key)));

const coversPort = (r: { ip_protocol: string; from_port?: number; to_port?: number }, port: number) => r.ip_protocol === "-1" || (r.ip_protocol === "tcp" && (r.from_port ?? 0) <= port && port <= (r.to_port ?? 65535));

export const VAL_082: RuleImpl = (ctx) =>
  albs(ctx).filter((a) => {
    const groups = ctx.g.securityGroupsOf(a.key);
    const inbound = groups.flatMap((g) => effectiveIngress(ctx.g, g.key));
    const outbound = groups.flatMap((g) => effectiveEgress(ctx.g, g.key));
    const listenerPorts = listenersOf(ctx.g, a.key).map((l) => l.port).filter(Number.isInteger);
    const targetPorts = targetGroupsOf(ctx.g).filter((t) => t.alb === a.key && t.type !== "lambda" && t.port !== undefined).map((t) => t.port!);
    return listenerPorts.some((p) => !inbound.some((r) => coversPort(r, p))) || targetPorts.some((p) => !outbound.some((r) => coversPort(r, p)));
  }).map((a) => hit(a.key));

export const VAL_083: RuleImpl = (ctx) =>
  targetGroupsOf(ctx.g).filter((t) => t.edges.some((e) => {
    const h = e.props?.health_check;
    if (h === null || typeof h !== "object" || Array.isArray(h)) return false;
    const n = (k: string) => (h as Record<string, unknown>)[k];
    const within = (v: unknown, lo: number, hi: number) => v === undefined || (typeof v === "number" && v >= lo && v <= hi);
    const matcher = Number(n("matcher"));
    return !within(n("interval"), 5, 300) || !within(n("timeout"), 2, 120) || !within(n("healthy_threshold"), 2, 10) || !within(n("unhealthy_threshold"), 2, 10)
      || (n("matcher") !== undefined && !(matcher >= 200 && matcher <= 499));
  })).map((t) => hit(t.alb));

export const VAL_084: RuleImpl = (ctx) =>
  albs(ctx).length > 50 || albs(ctx).some((a) => listenersOf(ctx.g, a.key).length > 50 || targetGroupsOf(ctx.g).filter((t) => t.alb === a.key).length > 100) ? [hit(...albs(ctx).map((a) => a.key))] : [];

export const SEC_024: RuleImpl = (ctx) =>
  albs(ctx).filter((a) => {
    if (!internetFacing(ctx, a.key)) return false;
    const ls = listenersOf(ctx.g, a.key);
    return !ls.some((l) => l.protocol === "HTTPS") || ls.some((l) => l.protocol === "HTTP" && l.action.type === "forward");
  }).map((a) => hit(a.key));

const OLD_POLICIES = new Set(["ELBSecurityPolicy-2016-08", "ELBSecurityPolicy-TLS-1-0-2015-04", "ELBSecurityPolicy-TLS-1-1-2017-01", "ELBSecurityPolicy-FS-2018-06", "ELBSecurityPolicy-FS-1-1-2019-08"]);

export const SEC_025: RuleImpl = (ctx) =>
  albs(ctx).filter((a) => listenersOf(ctx.g, a.key).some((l) => l.protocol === "HTTPS" && l.ssl_policy !== undefined && OLD_POLICIES.has(l.ssl_policy))).map((a) => hit(a.key));

export const SEC_026: RuleImpl = (ctx) => albs(ctx).filter((a) => a.props.drop_invalid_header_fields !== true).map((a) => hit(a.key));
export const SEC_027: RuleImpl = (ctx) => albs(ctx).filter((a) => a.props.enable_deletion_protection !== true).map((a) => hit(a.key));
export const SEC_028: RuleImpl = (ctx) =>
  albs(ctx).filter((a) => !(ctx.g.prop(a.key, "access_logs.enabled") === true && ctx.g.edges("resource-policy").some((e) => e.from === a.key && ctx.g.node(e.to)?.service === "s3"))).map((a) => hit(a.key));

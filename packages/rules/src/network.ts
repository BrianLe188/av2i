import { contains, isIpv6, overlaps, parseCidr } from "./cidr.ts";
import { hit, type Ctx, type Hit, type RuleImpl } from "./context.ts";

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** The CIDR of a node, or null when absent or malformed. */
const cidrOf = (ctx: Ctx, key: string) => parseCidr(ctx.g.prop(key, "cidr_block"));

const RESERVED_VPC = ["0.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "224.0.0.0/4"].map((s) => parseCidr(s)!);

export const VAL_001: RuleImpl = (ctx) =>
  ctx.g.nodesOf("vpc").filter((v) => { const c = cidrOf(ctx, v.key); return !c || c.prefix < 16 || c.prefix > 28; }).map((v) => hit(v.key));

export const VAL_002: RuleImpl = (ctx) =>
  ctx.g.nodesOf("vpc").filter((v) => { const c = cidrOf(ctx, v.key); return !!c && RESERVED_VPC.some((r) => contains(r, c)); }).map((v) => hit(v.key));

export const VAL_003: RuleImpl = (ctx) =>
  ctx.g.nodesOf("subnet").filter((s) => { const c = cidrOf(ctx, s.key); return !c || c.prefix < 16 || c.prefix > 28; }).map((s) => hit(s.key));

export const VAL_004: RuleImpl = (ctx) =>
  ctx.g.nodesOf("subnet").filter((s) => {
    const c = cidrOf(ctx, s.key);
    const vpc = ctx.g.vpcOf(s.key);
    const vc = vpc ? cidrOf(ctx, vpc.key) : null;
    return !!c && !!vc && !contains(vc, c);
  }).map((s) => hit(s.key));

export const VAL_005: RuleImpl = (ctx) => {
  const out: Hit[] = [];
  const subnets = ctx.g.nodesOf("subnet");
  for (let i = 0; i < subnets.length; i++) {
    for (let j = i + 1; j < subnets.length; j++) {
      const a = subnets[i]!, b = subnets[j]!;
      if (ctx.g.vpcOf(a.key)?.key !== ctx.g.vpcOf(b.key)?.key) continue;
      const ca = cidrOf(ctx, a.key), cb = cidrOf(ctx, b.key);
      if (ca && cb && overlaps(ca, cb)) out.push(hit(a.key, b.key));
    }
  }
  return out;
};

export const VAL_006: RuleImpl = (ctx) =>
  ctx.g.nodesOf("subnet").filter((s) => !str(s.props.availability_zone) && !str(s.props.availability_zone_id)).map((s) => hit(s.key));

export const VAL_007: RuleImpl = (ctx) => {
  const byVpc = new Map<string, string[]>();
  for (const igw of ctx.g.nodesOf("internet-gateway")) {
    const vpc = igw.parent ? ctx.g.vpcOf(igw.key) : undefined;
    if (vpc) byVpc.set(vpc.key, [...(byVpc.get(vpc.key) ?? []), igw.key]);
  }
  return [...byVpc.values()].filter((l) => l.length > 1).map((l) => hit(...l));
};

export const VAL_008: RuleImpl = (ctx) =>
  ctx.g.nodesOf("internet-gateway").filter((n) => !ctx.g.vpcOf(n.key)).map((n) => hit(n.key));

const DEST_KEYS = ["destination_cidr_block", "destination_ipv6_cidr_block", "destination_prefix_list_id"];

export const VAL_009: RuleImpl = (ctx) =>
  ctx.g.edges("route").filter((e) => ctx.g.node(e.to)?.service !== "vpc-endpoint-s3" && DEST_KEYS.filter((k) => e.props?.[k] !== undefined).length > 1).map((e) => hit(e.from, e.to));

export const VAL_010: RuleImpl = (ctx) => {
  const out: Hit[] = [];
  for (const e of ctx.g.edges("route")) {
    const target = ctx.g.node(e.to);
    if (!target) continue;
    const tableVpc = ctx.g.vpcOf(e.from)?.key;
    if (target.service === "internet-gateway") {
      const attached = ctx.g.vpcOf(target.key)?.key;
      if (!attached || attached !== tableVpc) out.push(hit(e.from, e.to));
    } else if (target.service === "nat-gateway" || target.service === "vpc-endpoint-s3") {
      if (ctx.g.vpcOf(target.key)?.key !== tableVpc) out.push(hit(e.from, e.to));
    }
  }
  return out;
};

const isPublicZonalNat = (ctx: Ctx, key: string) =>
  ctx.g.nodesOf("nat-gateway").some((n) => n.key === key && (n.props.availability_mode ?? "zonal") === "zonal" && (n.props.connectivity_type ?? "public") === "public");

export const VAL_011: RuleImpl = (ctx) =>
  ctx.g.nodesOf("nat-gateway").filter((n) => isPublicZonalNat(ctx, n.key) && (ctx.g.parentOf(n.key)?.service !== "subnet" || ctx.g.elasticIpsOf(n.key).length === 0)).map((n) => hit(n.key));

export const VAL_012: RuleImpl = (ctx) =>
  ctx.g.nodesOf("nat-gateway").filter((n) => {
    const host = ctx.g.parentOf(n.key);
    return isPublicZonalNat(ctx, n.key) && host?.service === "subnet" && !ctx.facts.subnets.get(host.key)?.public;
  }).map((n) => hit(n.key));

export const VAL_013: RuleImpl = (ctx) => {
  const out: Hit[] = [];
  for (const s of ctx.g.nodesOf("subnet")) {
    const table = ctx.facts.subnets.get(s.key)?.routeTable;
    if (!table) continue;
    for (const r of ctx.g.routesOf(table)) {
      if (r.target.service !== "nat-gateway") continue;
      const host = ctx.g.parentOf(r.target.key);
      const az = str(s.props.availability_zone), hostAz = host ? str(host.props.availability_zone) : undefined;
      if (az && hostAz && az !== hostAz) out.push(hit(s.key, r.target.key));
    }
  }
  return out;
};

export const VAL_014: RuleImpl = (ctx) =>
  ctx.g.nodesOf("subnet").filter((s) => ctx.g.routeTablesOf(s.key).length > 1).map((s) => hit(s.key));

export const VAL_015: RuleImpl = (ctx) =>
  ctx.g.edges("route-association").filter((e) => {
    const a = ctx.g.vpcOf(e.from)?.key, b = ctx.g.vpcOf(e.to)?.key;
    return !!a && !!b && a !== b;
  }).map((e) => hit(e.from, e.to));

export const VAL_016: RuleImpl = (ctx) => {
  const out: Hit[] = [];
  for (const t of ctx.g.nodesOf("route-table")) {
    const seen = new Map<string, string>();
    for (const r of ctx.g.routesOf(t.key)) {
      if (!r.destination) continue;
      const prev = seen.get(r.destination);
      if (prev !== undefined) out.push(hit(t.key, r.target.key, prev));
      else seen.set(r.destination, r.target.key);
    }
  }
  return out;
};

const RESERVED_ROUTE = parseCidr("169.254.168.0/22")!;
export const VAL_017: RuleImpl = (ctx) =>
  ctx.g.edges("route").filter((e) => {
    const d = e.props?.destination_cidr_block ?? e.props?.destination_ipv6_cidr_block;
    if (isIpv6(d)) return typeof d === "string" && d.toLowerCase().startsWith("fd00:ec2:");
    const c = parseCidr(d);
    return !!c && contains(RESERVED_ROUTE, c);
  }).map((e) => hit(e.from, e.to));

export const VAL_028: RuleImpl = (ctx) => {
  const out: Hit[] = [];
  for (const nat of ctx.g.nodesOf("nat-gateway")) {
    const host = ctx.g.parentOf(nat.key);
    const table = host ? ctx.facts.subnets.get(host.key)?.routeTable : null;
    if (table && ctx.g.routesOf(table).some((r) => r.target.key === nat.key && r.destination === "0.0.0.0/0")) out.push(hit(nat.key, table));
  }
  return out;
};

export const VAL_122: RuleImpl = (ctx) => {
  const out: Hit[] = [];
  for (const t of ctx.g.nodesOf("route-table")) {
    const eps = ctx.g.routesOf(t.key).filter((r) => r.target.service === "vpc-endpoint-s3");
    if (eps.length > 1) out.push(hit(t.key, ...eps.map((r) => r.target.key)));
    for (const r of eps) if (ctx.g.vpcOf(r.target.key)?.key !== ctx.g.vpcOf(t.key)?.key) out.push(hit(t.key, r.target.key));
  }
  return out;
};

export const VAL_124: RuleImpl = (ctx) =>
  ctx.g.nodesOf("vpc").filter((v) => {
    const hasEndpoint = ctx.g.nodesOf("vpc-endpoint-s3").some((e) => ctx.g.vpcOf(e.key)?.key === v.key);
    return hasEndpoint && !((v.props.enable_dns_support ?? true) === true && v.props.enable_dns_hostnames === true);
  }).map((v) => hit(v.key));

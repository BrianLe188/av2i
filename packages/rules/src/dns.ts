import { aliasRecords, aliasesOf, certNames, certOf, certRegion, covers, zoneFor } from "@av2i/engine";
import { hit, type Ctx, type RuleImpl } from "./context.ts";

const certs = (ctx: Ctx) => ctx.g.nodesOf("acm");
const zones = (ctx: Ctx) => ctx.g.nodesOf("route53");
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const VAL_099: RuleImpl = (ctx) =>
  certs(ctx).filter((c) => !c.props.domain_name || certNames(c).length > 10 || (c.props.validation_method !== undefined && c.props.validation_method !== "DNS")).map((c) => hit(c.key));

/** A name no hosted zone of the design holds cannot be validated by a record the platform creates. */
export const VAL_100: RuleImpl = (ctx) => certs(ctx).filter((c) => certNames(c).some((n) => !zoneFor(ctx.g, n))).map((c) => hit(c.key));

export const VAL_101: RuleImpl = (ctx) => {
  const out = [];
  for (const c of certs(ctx)) {
    for (const e of ctx.g.edges("cert-attach").filter((x) => x.from === c.key)) {
      const consumer = ctx.g.node(e.to);
      const region = certRegion(ctx.g, c);
      if ((consumer?.service === "cloudfront" && region !== "us-east-1") || (consumer?.service === "alb" && region !== ctx.region)) out.push(hit(c.key, e.to));
    }
  }
  return out;
};

/** Names each consumer serves: a distribution's aliases, or the names a DNS alias gives a load balancer. */
function served(ctx: Ctx, consumer: string): string[] {
  const n = ctx.g.node(consumer);
  if (!n) return [];
  if (n.service === "cloudfront") return aliasesOf(n);
  return ctx.g.edges("dns-alias").filter((e) => e.to === consumer).flatMap((e) => aliasRecords(ctx.g, e).map((r) => r.name));
}

const uncovered = (ctx: Ctx, consumer: string) => {
  const cert = certOf(ctx.g, consumer);
  return cert ? served(ctx, consumer).filter((s) => !certNames(cert).some((n) => covers(n, s))) : [];
};

export const VAL_102: RuleImpl = (ctx) =>
  [...ctx.g.nodesOf("alb"), ...ctx.g.nodesOf("cloudfront")].filter((c) => uncovered(ctx, c.key).length > 0).map((c) => hit(c.key, certOf(ctx.g, c.key)!.key));

export const SEC_034: RuleImpl = (ctx) => certs(ctx).filter((c) => ctx.g.edges("cert-validation").some((e) => e.from === c.key) && ctx.g.edges("cert-attach").some((e) => e.from === c.key)).map((c) => hit(c.key));

const records = (z: { props: Record<string, unknown> }): Record<string, unknown>[] => (Array.isArray(z.props.records) ? (z.props.records as unknown[]).map(obj) : []);

export const VAL_085: RuleImpl = (ctx) =>
  zones(ctx).filter((z) => records(z).some((r) => {
    const alias = r.alias !== undefined;
    const plain = r.records !== undefined;
    return alias === plain || (alias && (r.ttl !== undefined || r.records !== undefined));
  })).map((z) => hit(z.key));

export const VAL_087: RuleImpl = (ctx) =>
  zones(ctx).filter((z) => records(z).some((r) => r.type === "CNAME" && String(r.name ?? "").toLowerCase().replace(/\.$/, "") === String(z.props.name ?? "").toLowerCase().replace(/\.$/, ""))).map((z) => hit(z.key));

export const VAL_088: RuleImpl = (ctx) =>
  ctx.g.edges("dns-alias").filter((e) => ctx.g.node(e.to)?.service === "cloudfront" && (ctx.g.node(e.from)?.props.private === true || aliasRecords(ctx.g, e).length === 0)).map((e) => hit(e.from, e.to));

export const VAL_090: RuleImpl = (ctx) =>
  zones(ctx).filter((z) => {
    const seen = new Set<string>();
    return records(z).some((r) => { const k = `${String(r.name).toLowerCase()}|${r.type}`; const dup = seen.has(k); seen.add(k); return dup; }) || zones(ctx).length > 500;
  }).map((z) => hit(z.key));

export const SEC_033: RuleImpl = (ctx) => zones(ctx).filter((z) => z.props.force_destroy === true).map((z) => hit(z.key));

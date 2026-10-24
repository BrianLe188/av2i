import { aliasesOf, bucketPolicy, certNames, certOf, covers, originsOf, userStatements, type Statement } from "@av2i/engine";
import { hit, type Ctx, type Hit, type RuleImpl } from "./context.ts";

const cdns = (ctx: Ctx) => ctx.g.nodesOf("cloudfront");
const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const behaviours = (ctx: Ctx, key: string): Record<string, unknown>[] => {
  const n = ctx.g.node(key)!;
  return [obj(n.props.default_cache_behavior), ...(Array.isArray(n.props.ordered_cache_behavior) ? (n.props.ordered_cache_behavior as unknown[]).map(obj) : [])];
};

export const VAL_091: RuleImpl = (ctx) =>
  ctx.g.edges("origin").filter((e) => ctx.g.node(e.to)?.service === "s3" && (e.props?.access === "none" || e.props?.website_endpoint === true)).map((e) => hit(e.from, e.to));

export const VAL_092: RuleImpl = (ctx) =>
  cdns(ctx).filter((c) => {
    const origins = originsOf(ctx.g, c.key);
    if (origins.length === 0) return true;
    const names = new Set(origins.map((o) => o.id));
    const ordered = Array.isArray(c.props.ordered_cache_behavior) ? (c.props.ordered_cache_behavior as unknown[]).map(obj) : [];
    if (ordered.some((b) => !b.path_pattern || (b.origin !== undefined && !names.has(String(b.origin))))) return true;
    const errors = Array.isArray(c.props.custom_error_response) ? (c.props.custom_error_response as unknown[]).map(obj) : [];
    return errors.some((r) => (r.response_code === undefined) !== (r.response_page_path === undefined));
  }).map((c) => hit(c.key));

export const VAL_093: RuleImpl = (ctx) =>
  cdns(ctx).filter((c) => {
    const cert = certOf(ctx.g, c.key);
    return !!cert && aliasesOf(c).some((a) => !certNames(cert).some((n) => covers(n, a)));
  }).map((c) => hit(c.key, certOf(ctx.g, c.key)!.key));

export const VAL_094: RuleImpl = (ctx) =>
  cdns(ctx).filter((c) => {
    const cert = certOf(ctx.g, c.key);
    const dflt = ctx.g.prop(c.key, "viewer_certificate.cloudfront_default_certificate") === true;
    return (!!cert && dflt) || (aliasesOf(c).length > 0 && !cert);
  }).map((c) => hit(c.key));

export const VAL_095: RuleImpl = (ctx) =>
  cdns(ctx).length > 500 || cdns(ctx).some((c) => aliasesOf(c).length > 100 || originsOf(ctx.g, c.key).length > 100 || behaviours(ctx, c.key).length > 75) ? [hit(...cdns(ctx).map((c) => c.key))] : [];

export const VAL_096: RuleImpl = (ctx) =>
  ctx.g.edges("origin").filter((e) => ctx.g.node(e.to)?.service === "s3" && e.props?.access !== "none" && text(e.props?.signing_behavior) !== undefined && !["always", "no-override"].includes(String(e.props?.signing_behavior))).map((e) => hit(e.from, e.to));

export const VAL_097: RuleImpl = (ctx) =>
  ctx.g.edges("origin").filter((e) => {
    const within = (v: unknown, lo: number, hi: number) => v === undefined || (typeof v === "number" && v >= lo && v <= hi);
    return !within(e.props?.connection_attempts, 1, 3) || !within(e.props?.connection_timeout, 1, 10);
  }).map((e) => hit(e.from, e.to));

export const SEC_029: RuleImpl = (ctx) => cdns(ctx).filter((c) => behaviours(ctx, c.key).some((b) => b.viewer_protocol_policy === "allow-all")).map((c) => hit(c.key));

const OLD_TLS = new Set(["SSLv3", "TLSv1", "TLSv1_2016", "TLSv1.1_2016"]);
export const SEC_030: RuleImpl = (ctx) =>
  cdns(ctx).filter((c) => { const v = text(ctx.g.prop(c.key, "viewer_certificate.minimum_protocol_version")); return v !== undefined && OLD_TLS.has(v); }).map((c) => hit(c.key));

export const SEC_031: RuleImpl = (ctx) =>
  ctx.g.edges("origin").filter((e) => ctx.g.node(e.to)?.service === "s3" && (e.props?.access === "none" || e.props?.website_endpoint === true)).map((e) => hit(e.from, e.to));

export const SEC_032: RuleImpl = (ctx) => cdns(ctx).filter((c) => !c.props.web_acl_id).map((c) => hit(c.key));

/** A distribution's certificate, and the Region it lives in, are checked together with the aliases above; this one is only about the bucket side. */
const buckets = (ctx: Ctx) => ctx.g.nodesOf("s3");
const hasSecureTransportDeny = (s: Statement[]) => s.some((x) => x.Effect === "Deny" && JSON.stringify(x.Condition ?? {}).includes("aws:SecureTransport"));

export const SEC_015: RuleImpl = (ctx) => buckets(ctx).filter((b) => { const s = bucketPolicy(ctx.g, b); return s.length > 0 && !hasSecureTransportDeny(s); }).map((b) => hit(b.key));

const star = (p: unknown) => p === "*" || obj(p).AWS === "*";

export const VAL_052: RuleImpl = (ctx) =>
  buckets(ctx).filter((b) => ctx.g.prop(b.key, "public_access_block.block_public_policy") !== false && userStatements(b).some((s) => s.Effect === "Allow" && star(s.Principal) && s.Condition === undefined)).map((b) => hit(b.key));

export const VAL_053: RuleImpl = (ctx) => buckets(ctx).filter((b) => JSON.stringify({ Version: "2012-10-17", Statement: bucketPolicy(ctx.g, b) }).length > 20480).map((b) => hit(b.key));

export const VAL_054: RuleImpl = (ctx) =>
  ctx.g.edges("origin").filter((e) => {
    if (ctx.g.node(e.to)?.service !== "s3" || e.props?.access === "none") return false;
    const ownership = text(ctx.g.prop(e.to, "ownership_controls.object_ownership")) ?? "BucketOwnerEnforced";
    return e.props?.website_endpoint === true || !["BucketOwnerEnforced", "BucketOwnerPreferred"].includes(ownership);
  }).map((e) => hit(e.from, e.to));

export const VAL_055: RuleImpl = (ctx) =>
  ctx.g.edges("resource-policy").filter((e) => ctx.g.node(e.from)?.service === "alb" && ctx.g.node(e.to)?.service === "s3" && (text(ctx.g.prop(e.to, "encryption.sse_algorithm")) ?? "AES256") !== "AES256").map((e) => hit(e.from, e.to));

const hasPrincipal = (s: Record<string, unknown>) => s.Principal !== undefined || s.NotPrincipal !== undefined;
const badStatement = (s: unknown, resourceBased: boolean) => {
  const o = obj(s);
  if (o.Effect !== "Allow" && o.Effect !== "Deny") return true;
  if (o.Action === undefined && o.NotAction === undefined) return true;
  if (resourceBased ? !hasPrincipal(o) : o.Resource === undefined && o.NotResource === undefined) return true;
  return false;
};
const doc = (v: unknown): Record<string, unknown> | null => {
  if (v === undefined || v === null || v === "") return null;
  try { return obj(typeof v === "string" ? JSON.parse(v) : v); } catch { return { Version: "invalid" }; }
};

/** Hand-written bucket policies and role policies: version, and the elements each statement needs. */
export const VAL_117: RuleImpl = (ctx) => {
  const out: Hit[] = [];
  const check = (key: string, d: Record<string, unknown> | null, resourceBased: boolean) => {
    if (!d) return;
    const list = Array.isArray(d.Statement) ? d.Statement : d.Statement ? [d.Statement] : [];
    if (d.Version !== "2012-10-17" || list.length === 0 || list.some((s) => badStatement(s, resourceBased))) out.push(hit(key));
  };
  for (const b of buckets(ctx)) check(b.key, doc(b.props.bucket_policy), true);
  for (const r of ctx.g.nodesOf("iam-role")) check(r.key, doc(r.props.raw_policy), false);
  return out;
};

export const SEC_044: RuleImpl = (ctx) =>
  ctx.g.nodesOf("vpc-endpoint-s3").length === 0 ? [] : buckets(ctx).filter((b) => JSON.stringify(userStatements(b)).includes("aws:SourceIp")).map((b) => hit(b.key));


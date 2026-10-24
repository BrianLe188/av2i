import { effectiveEgress, ingressRules, type SgRule } from "@av2i/engine";
import { hit, type Ctx, type RuleImpl } from "./context.ts";

/** Characters AWS accepts in a security group name or description (services/security-group.md). */
const ALLOWED = /^[a-zA-Z0-9 ._\-:/()#,@[\]+=&;{}!$*]*$/;

const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export const VAL_018: RuleImpl = (ctx) =>
  ctx.g.nodesOf("security-group").filter((sg) => {
    const name = text(sg.props.name);
    if (name === undefined) return false;
    return name.length > 255 || !ALLOWED.test(name) || name.startsWith("sg-");
  }).map((sg) => hit(sg.key));

export const VAL_019: RuleImpl = (ctx) => {
  const seen = new Map<string, string>();
  const out = [];
  for (const sg of ctx.g.nodesOf("security-group")) {
    const name = text(sg.props.name);
    const vpc = ctx.g.vpcOf(sg.key)?.key;
    if (name === undefined || !vpc) continue;
    const id = `${vpc}|${name.toLowerCase()}`;
    const first = seen.get(id);
    if (first) out.push(hit(first, sg.key));
    else seen.set(id, sg.key);
  }
  return out;
};

export const VAL_020: RuleImpl = (ctx) =>
  ctx.g.nodesOf("security-group").filter((sg) => {
    const d = text(sg.props.description);
    return d === undefined || d.length === 0 || d.length > 255 || !ALLOWED.test(d);
  }).map((sg) => hit(sg.key));

/** Rules of one direction and IP family; a rule on a prefix list counts as many rules as the list has entries. */
function weight(r: SgRule): number {
  return r.prefix_list_id ? Math.max(1, Number((r as SgRule & { prefix_list_entries?: number }).prefix_list_entries ?? 1)) : 1;
}

export const VAL_022: RuleImpl = (ctx: Ctx) => {
  const out = [];
  for (const sg of ctx.g.nodesOf("security-group")) {
    const dirs = { ingress: ingressRules(sg.props), egress: effectiveEgress(ctx.g, sg.key) };
    const over = Object.values(dirs).some((rules) =>
      [(r: SgRule) => !r.cidr_ipv6, (r: SgRule) => !!r.cidr_ipv6].some(
        (family) => rules.filter(family).reduce((n, r) => n + weight(r), 0) > ctx.limits.rulesPerDirection,
      ),
    );
    if (over) out.push(hit(sg.key));
  }
  return out;
};

export const VAL_123: RuleImpl = (ctx) =>
  ctx.g.nodesOf("vpc-endpoint-s3").filter((ep) => {
    const name = text(ep.props.service_name);
    const type = text(ep.props.vpc_endpoint_type);
    return (name !== undefined && name !== `com.amazonaws.${ctx.region}.s3`) || (type !== undefined && type !== "Gateway");
  }).map((ep) => hit(ep.key));

function isFullAccess(policy: unknown): boolean {
  if (policy === undefined || policy === null || policy === "") return true;
  let doc: any = policy;
  if (typeof policy === "string") {
    try { doc = JSON.parse(policy); } catch { return false; }
  }
  const statements = Array.isArray(doc?.Statement) ? doc.Statement : doc?.Statement ? [doc.Statement] : [];
  const one = (v: unknown) => (Array.isArray(v) ? v : [v]);
  return statements.length > 0 && statements.some(
    (s: any) => s.Effect === "Allow" && !s.Condition && one(s.Principal?.AWS ?? s.Principal).includes("*") && one(s.Action).includes("*") && one(s.Resource).includes("*"),
  );
}

export const SEC_043: RuleImpl = (ctx) => ctx.g.nodesOf("vpc-endpoint-s3").filter((ep) => isFullAccess(ep.props.policy)).map((ep) => hit(ep.key));

/** An endpoint policy names `Principal: "*"` in every statement (limits go in the aws:PrincipalArn condition) and fits in 20,480 characters. */
export const VAL_125: RuleImpl = (ctx) =>
  ctx.g.nodesOf("vpc-endpoint-s3").filter((ep) => {
    const policy = ep.props.policy;
    if (policy === undefined || policy === null || policy === "") return false;
    let doc: any = policy;
    if (typeof policy === "string") {
      try { doc = JSON.parse(policy); } catch { return true; }
    }
    const statements = Array.isArray(doc?.Statement) ? doc.Statement : doc?.Statement ? [doc.Statement] : [];
    const star = (p: any) => p === "*" || p?.AWS === "*";
    return JSON.stringify(doc).length > 20480 || statements.length === 0 || !statements.every((st: any) => star(st.Principal));
  }).map((ep) => hit(ep.key));

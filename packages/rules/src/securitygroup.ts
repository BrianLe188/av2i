import { effectiveEgress, ingressRules, type SgRule } from "@av2i/engine";
import { hit, type Ctx, type Hit, type RuleImpl } from "./context.ts";

const WORLD = new Set(["0.0.0.0/0", "::/0"]);
const peerOf = (r: SgRule) => r.cidr_ipv4 ?? r.cidr_ipv6 ?? r.prefix_list_id ?? r.prefix_list_of ?? r.referenced_security_group_id;
const peerCount = (r: SgRule) => [r.cidr_ipv4, r.cidr_ipv6, r.prefix_list_id, r.referenced_security_group_id].filter((x) => x !== undefined).length;
const fromWorld = (r: SgRule) => WORLD.has(r.cidr_ipv4 ?? "") || WORLD.has(r.cidr_ipv6 ?? "");
const isPortProtocol = (r: SgRule) => r.ip_protocol === "tcp" || r.ip_protocol === "udp";
const covers = (r: SgRule, port: number) => r.ip_protocol === "-1" || (isPortProtocol(r) && (r.from_port ?? 0) <= port && port <= (r.to_port ?? 65535));

/** Every ingress and egress rule of every group, with where it lives. */
function allRules(ctx: Ctx): { sg: string; dir: "ingress" | "egress"; rule: SgRule }[] {
  const out: { sg: string; dir: "ingress" | "egress"; rule: SgRule }[] = [];
  for (const sg of ctx.g.nodesOf("security-group")) {
    for (const rule of ingressRules(sg.props)) out.push({ sg: sg.key, dir: "ingress", rule });
    for (const rule of effectiveEgress(ctx.g, sg.key)) out.push({ sg: sg.key, dir: "egress", rule });
  }
  return out;
}

export const VAL_023: RuleImpl = (ctx) => allRules(ctx).filter(({ rule }) => !rule.generated && peerCount(rule) !== 1).map(({ sg }) => hit(sg));

export const VAL_024: RuleImpl = (ctx) =>
  allRules(ctx).filter(({ rule: r }) => {
    if (r.generated) return false;
    if (r.ip_protocol === "-1") return r.from_port !== undefined || r.to_port !== undefined;
    if (isPortProtocol(r)) {
      const f = r.from_port, t = r.to_port;
      return !Number.isInteger(f) || !Number.isInteger(t) || f! < 0 || t! > 65535 || f! > t!;
    }
    return false;
  }).map(({ sg }) => hit(sg));

export const VAL_025: RuleImpl = (ctx) =>
  allRules(ctx).filter(({ sg, rule }) => {
    const peer = rule.referenced_security_group_id;
    return !!peer && !!ctx.g.node(peer) && ctx.g.vpcOf(peer)?.key !== ctx.g.vpcOf(sg)?.key;
  }).map(({ sg, rule }) => hit(sg, rule.referenced_security_group_id!));

export const VAL_026: RuleImpl = (ctx) => {
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const { sg, dir, rule } of allRules(ctx)) {
    const id = [sg, dir, rule.ip_protocol, rule.from_port, rule.to_port, peerOf(rule)].join("|");
    if (seen.has(id)) out.push(hit(sg));
    seen.add(id);
  }
  return out;
};

export const VAL_027: RuleImpl = (ctx) =>
  ctx.g.edges("sg-attach").filter((e) => {
    const a = ctx.g.vpcOf(e.from)?.key, b = ctx.g.vpcOf(e.to)?.key;
    return !!a && !!b && a !== b;
  }).map((e) => hit(e.from, e.to));

export const SEC_001: RuleImpl = (ctx) =>
  allRules(ctx).filter(({ dir, rule: r }) => dir === "ingress" && fromWorld(r) && (r.ip_protocol === "-1" || (isPortProtocol(r) && (r.from_port ?? 0) === 0 && (r.to_port ?? 65535) === 65535))).map(({ sg }) => hit(sg));

export const SEC_002: RuleImpl = (ctx) =>
  allRules(ctx).filter(({ dir, rule: r }) => dir === "ingress" && fromWorld(r) && r.ip_protocol !== "-1" && (covers(r, 22) || covers(r, 3389))
    && !(isPortProtocol(r) && (r.from_port ?? 0) === 0 && (r.to_port ?? 65535) === 65535)).map(({ sg }) => hit(sg));

export const SEC_003: RuleImpl = (ctx) =>
  allRules(ctx).filter(({ dir, rule: r }) => {
    if (dir !== "ingress" || !(r.cidr_ipv4 || r.cidr_ipv6 || r.prefix_list_id)) return false;
    if (r.ip_protocol === "-1") return true;
    return isPortProtocol(r) && (r.to_port ?? 65535) - (r.from_port ?? 0) + 1 > 100;
  }).map(({ sg }) => hit(sg));

export const SEC_004: RuleImpl = (ctx) =>
  [...ctx.facts.workloads.keys()].filter((w) => ctx.g.securityGroupsOf(w).length === 0).map((w) => hit(w));

/** The engine always manages the VPC default security group with no rules (decision D-006), so there is nothing to report. */
export const SEC_005: RuleImpl = () => [];

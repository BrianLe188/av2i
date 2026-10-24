import { MANAGED, requiredManaged, slotFor, type Graph } from "@av2i/engine";
import type { NormalizedNode, Value } from "@av2i/model";
import { hit, type Ctx, type RuleImpl } from "./context.ts";

const roles = (ctx: Ctx) => ctx.g.nodesOf("iam-role");
const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const policyDoc = (v: Value | undefined): { Statement?: unknown } | null => {
  if (v === undefined || v === null || v === "") return null;
  try {
    return (typeof v === "string" ? JSON.parse(v) : v) as { Statement?: unknown };
  } catch {
    return null;
  }
};

interface Stmt {
  effect: string;
  actions: string[];
  resources: string[];
}

/** Allow and Deny statements of a role's raw policy, with Action and Resource always as lists. */
function rawStatements(role: NormalizedNode): Stmt[] {
  const doc = policyDoc(role.props.raw_policy);
  const list = Array.isArray(doc?.Statement) ? doc.Statement : doc?.Statement ? [doc.Statement] : [];
  const many = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined ? [] : [String(v)]);
  return list.map((s: any) => ({ effect: String(s.Effect ?? "Allow"), actions: many(s.Action), resources: many(s.Resource) }));
}

const compact = (v: unknown) => JSON.stringify(v).replace(/\s+/g, "").length;

/** Managed policies a role holds, whoever added them: what is written on it plus what the platform adds to roles it made. */
function managed(g: Graph, role: NormalizedNode): string[] {
  const own = Array.isArray(role.props.managed_policies) ? (role.props.managed_policies as unknown[]).map(String) : [];
  if (role.origin !== "generated") return own;
  const derived = g.consumersOf(role.key).flatMap((c) => (c.slot ? requiredManaged(c.consumer.service, c.slot, g.subnetsOf(c.consumer.key).length > 0) : []));
  return [...own, ...derived];
}

const allows = (role: NormalizedNode, action: string) => rawStatements(role).some((s) => s.effect === "Allow" && s.actions.some((a) => a === action || a === "*" || (a.endsWith("*") && action.startsWith(a.slice(0, -1)))));

export const VAL_103: RuleImpl = (ctx) => {
  const out = [];
  const seen = new Map<string, string>();
  for (const r of roles(ctx)) {
    const name = text(r.props.name) ?? r.key.replace(/_/g, "-");
    if (name.length > 64 || !/^[A-Za-z0-9+=,.@_-]+$/.test(name)) { out.push(hit(r.key)); continue; }
    const first = seen.get(name.toLowerCase());
    if (first) out.push(hit(first, r.key));
    else seen.set(name.toLowerCase(), r.key);
  }
  return out;
};

export const VAL_106: RuleImpl = (ctx) => roles(ctx).filter((r) => ctx.g.consumersOf(r.key).length === 0).map((r) => hit(r.key));

export const VAL_107: RuleImpl = (ctx) => roles(ctx).filter((r) => new Set(managed(ctx.g, r)).size > 20).map((r) => hit(r.key));

export const VAL_108: RuleImpl = (ctx) =>
  roles(ctx).filter((r) => {
    const principals = new Set(ctx.g.consumersOf(r.key).map((c) => (c.slot ? slotFor(c.consumer.service, c.slot)?.trust : undefined)));
    const trust = compact({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: [...principals] }, Action: "sts:AssumeRole" }] });
    return trust > 2048 || compact(policyDoc(r.props.raw_policy) ?? {}) > 10240;
  }).map((r) => hit(r.key));

export const VAL_109: RuleImpl = (ctx) =>
  ctx.g.nodesOf("ec2").filter((n) => ctx.g.rolesOf(n.key).length > 1 || n.key.length > 128).map((n) => hit(n.key));

export const VAL_110: RuleImpl = (ctx) =>
  ctx.g.nodesOf("lambda").filter((f) => ctx.g.rolesOf(f.key).filter((r) => r.slot === "execution").length !== 1).map((f) => hit(f.key));

export const VAL_111: RuleImpl = (ctx) =>
  ctx.g.nodesOf("lambda").filter((f) => {
    if (ctx.g.subnetsOf(f.key).length === 0) return false;
    return ctx.g.rolesOf(f.key).filter((r) => r.slot === "execution").some(({ role }) => {
      if (managed(ctx.g, role).includes(MANAGED.lambdaVpc)) return false;
      return !["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"].every((a) => allows(role, a));
    });
  }).map((f) => hit(f.key));

const services = (ctx: Ctx) => ctx.g.nodesOf("ecs").filter((n) => n.props.part === "service");

export const VAL_112: RuleImpl = (ctx) =>
  services(ctx).filter((s) => s.props.enable_execute_command === true && !ctx.g.rolesOf(s.key).some((r) => r.slot === "task")).map((s) => hit(s.key));

export const VAL_113: RuleImpl = (ctx) =>
  services(ctx).filter((s) => {
    if (s.props.enable_execute_command !== true) return false;
    const task = ctx.g.rolesOf(s.key).find((r) => r.slot === "task");
    return !!task && !["ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"].every((a) => allows(task.role, a));
  }).map((s) => hit(s.key));

export const VAL_114: RuleImpl = (ctx) =>
  ctx.g.nodesOf("rds").filter((d) => {
    if (typeof d.props.monitoring_interval !== "number" || d.props.monitoring_interval <= 0) return false;
    const role = ctx.g.rolesOf(d.key).find((r) => r.slot === "monitoring")?.role;
    return !role || !managed(ctx.g, role).includes(MANAGED.rdsMonitoring);
  }).map((d) => hit(d.key));

export const VAL_116: RuleImpl = (ctx) =>
  services(ctx).filter((s) => {
    const exec = ctx.g.rolesOf(s.key).find((r) => r.slot === "execution")?.role;
    if (!exec) return false;
    return !managed(ctx.g, exec).includes(MANAGED.ecsExecution) && !(allows(exec, "ecr:BatchGetImage") && allows(exec, "logs:PutLogEvents"));
  }).map((s) => hit(s.key));

export const SEC_035: RuleImpl = (ctx) => roles(ctx).filter((r) => managed(ctx.g, r).includes(MANAGED.administrator)).map((r) => hit(r.key));

/** Actions that need `Resource: "*"` and so are exempt from SEC-037 (relations/grant.md). */
const NEEDS_STAR = /^(ecr:GetAuthorizationToken|ssmmessages:.*|ec2:(Create|Delete|Describe|Assign|Unassign)Network.*|ec2:DescribeSubnets|ec2:(Un)?AssignPrivateIpAddresses)$/;

export const SEC_036: RuleImpl = (ctx) =>
  roles(ctx).filter((r) => rawStatements(r).some((s) => s.effect === "Allow" && s.resources.includes("*") && s.actions.some((a) => a === "*" || /^[a-z0-9-]+:\*$/.test(a)))).map((r) => hit(r.key));

export const SEC_037: RuleImpl = (ctx) =>
  roles(ctx).filter((r) => rawStatements(r).some((s) => s.effect === "Allow" && s.resources.includes("*") && s.actions.some((a) => a !== "*" && !/^[a-z0-9-]+:\*$/.test(a) && !NEEDS_STAR.test(a)))).map((r) => hit(r.key));

export const SEC_038: RuleImpl = (ctx) =>
  roles(ctx).filter((r) => rawStatements(r).some((s) => s.effect === "Allow" && s.actions.some((a) => /^[a-z0-9-]+:\*$/.test(a)))).map((r) => hit(r.key));

export const SEC_041: RuleImpl = (ctx) =>
  roles(ctx).filter((r) => {
    const consumers = ctx.g.consumersOf(r.key).map((c) => c.consumer);
    const kinds = new Set(consumers.map((c) => c.service));
    return kinds.size > 1 || consumers.filter((c) => c.service === "lambda" || c.service === "ecs").length > 1;
  }).map((r) => hit(r.key));

export const SEC_042: RuleImpl = (ctx) =>
  roles(ctx).filter((r) => rawStatements(r).some((s) => s.effect === "Allow" && s.actions.some((a) => ["iam:PassRole", "iam:CreateRole", "iam:AttachRolePolicy", "iam:PutRolePolicy", "iam:*", "*"].includes(a)))).map((r) => hit(r.key));

export const SEC_008: RuleImpl = (ctx) =>
  ctx.g.nodesOf("lambda").filter((f) => ctx.g.subnetsOf(f.key).length > 0 && ctx.g.rolesOf(f.key).some((r) => r.slot === "execution" && managed(ctx.g, r.role).includes(MANAGED.lambdaVpc))).map((f) => hit(f.key));

/** A connection from a function that is not attached to the VPC cannot reach what sits in it. */
export const VAL_049: RuleImpl = (ctx) =>
  ctx.g.edges("network-access").filter((e) => ctx.g.node(e.from)?.service === "lambda" && ctx.g.subnetsOf(e.from).length === 0 && ctx.g.vpcOf(e.to)).map((e) => hit(e.from, e.to));

export const VAL_070: RuleImpl = (ctx) => {
  const out = [];
  for (const grant of ctx.g.edges("grant")) {
    if (ctx.g.node(grant.to)?.service !== "s3") continue;
    for (const { consumer } of ctx.g.consumersOf(grant.from)) {
      const f = ctx.facts.workloads.get(consumer.key);
      if (f && !f.internetEgress && !f.s3Endpoint) out.push(hit(consumer.key, grant.to));
    }
  }
  return out;
};


/** Per-account quotas, counted over the roles and instance profiles the design emits. */
export const VAL_121: RuleImpl = (ctx) => {
  const emitted = roles(ctx).filter((r) => ctx.g.consumersOf(r.key).length > 0);
  const profiles = ctx.g.edges("assume-role").filter((e) => ctx.g.node(e.to)?.service === "ec2");
  return emitted.length > 1000 || profiles.length > 1000 ? [hit(...emitted.map((r) => r.key))] : [];
};

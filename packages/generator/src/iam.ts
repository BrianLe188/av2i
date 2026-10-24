import { MANAGED, policiesOf, policyNameOf, requiredManaged, roleNameOf, SLOTS, slotFor, type Graph, type SlotId } from "@av2i/engine";
import type { NormalizedNode, Value } from "@av2i/model";
import { call, ref, type Block, type Expr } from "./hcl.ts";
import { resource, slug, template, toExpr, type PlanCtx } from "./ctx.ts";

const policyName = (arn: string) => arn.slice(arn.lastIndexOf("/") + 1);

/** Managed policies attached to a role: the ones written on it, plus the ones its slots require when the platform made the role. */
export function managedOf(g: Graph, role: NormalizedNode): string[] {
  const own = Array.isArray(role.props.managed_policies) ? (role.props.managed_policies as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const derived = role.origin === "generated" ? g.consumersOf(role.key).flatMap((c) => (c.slot ? requiredManaged(c.consumer.service, c.slot, g.subnetsOf(c.consumer.key).length > 0) : [])) : [];
  return [...new Set([...own, ...derived])];
}

/** A role is emitted only when some consumer runs as it (VAL-106). */
export const isEmitted = (g: Graph, role: NormalizedNode) => g.consumersOf(role.key).length > 0;

export const attachmentName = (role: string, arn: string) => `${role}_${slug(policyName(arn))}`;

/** `role.arn` of the role in a consumer's slot, if the consumer has one. */
export function roleRef(g: Graph, consumer: string, slot: SlotId): Expr | undefined {
  const r = g.rolesOf(consumer).find((x) => x.slot === slot);
  return r ? ref(`aws_iam_role.${r.role.key}.arn`) : undefined;
}

/** Policy resources a consumer must wait for: a service destroyed after its role policy is stuck (pitfall P-016 style). */
export function roleDependencies(g: Graph, consumer: string): Expr[] {
  const out: Expr[] = [];
  for (const { role } of g.rolesOf(consumer)) {
    for (const arn of managedOf(g, role)) out.push(ref(`aws_iam_role_policy_attachment.${attachmentName(role.key, arn)}`));
    for (const p of policiesOf(g, role.key)) out.push(ref(`aws_iam_role_policy_attachment.${role.key}_${p.key}`));
    if (statementsOf(g, role).length) out.push(ref(`aws_iam_role_policy.${role.key}_grants`));
  }
  return out;
}

interface Statement {
  Sid: string;
  Effect: "Allow";
  Action: string[];
  Resource: Expr;
}

const LEVEL_ORDER: Record<string, string[]> = { s3: ["read", "readwrite"], ecr: ["pull", "push"] };
const DEFAULT_LEVEL: Record<string, string> = { s3: "read", ecr: "pull" };

const alnum = (s: string) => s.replace(/[^A-Za-z0-9]/g, "");
const pascal = (s: string) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((x) => x[0]!.toUpperCase() + x.slice(1)).join("");

/** Statements generated for a role from its grants (relations/grant.md), grouped per target; the stronger level wins. */
export function statementsOf(g: Graph, role: NormalizedNode): Statement[] {
  const levels = new Map<string, { target: NormalizedNode; level: string }>();
  for (const e of g.edges("grant").filter((x) => x.from === role.key)) {
    const target = g.node(e.to);
    const order = target ? LEVEL_ORDER[target.service] : undefined;
    if (!target || !order) continue;
    const asked = typeof e.props?.level === "string" && order.includes(e.props.level) ? e.props.level : DEFAULT_LEVEL[target.service]!;
    const had = levels.get(target.key);
    if (!had || order.indexOf(asked) > order.indexOf(had.level)) levels.set(target.key, { target, level: asked });
  }
  const out: Statement[] = [];
  let token = false;
  for (const { target, level } of levels.values()) {
    const sid = alnum(pascal(`${target.service} ${level} ${target.key}`));
    if (target.service === "s3") {
      const arn = `aws_s3_bucket.${target.key}.arn`;
      out.push({ Sid: sid, Effect: "Allow", Action: level === "read" ? ["s3:GetObject"] : ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource: [template(`\${${arn}}/*`)] });
      out.push({ Sid: `${sid}List`, Effect: "Allow", Action: ["s3:ListBucket"], Resource: [ref(arn)] });
    } else {
      token = true;
      const arn = ref(`aws_ecr_repository.${target.key}.arn`);
      out.push({
        Sid: sid,
        Effect: "Allow",
        Action: level === "pull" ? ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"] : ["ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
        Resource: [arn],
      });
    }
  }
  // a Lambda function pulling its container image: the repository grants nothing, so its role does
  for (const c of g.consumersOf(role.key)) {
    if (c.consumer.service !== "lambda") continue;
    const repo = g.imageOf(c.consumer.key);
    if (!repo || out.some((s) => s.Sid === `LambdaPull${alnum(pascal(repo.key))}`)) continue;
    token = true;
    out.push({ Sid: `LambdaPull${alnum(pascal(repo.key))}`, Effect: "Allow", Action: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"], Resource: [ref(`aws_ecr_repository.${repo.key}.arn`)] });
  }
  if (token) out.unshift({ Sid: "EcrToken", Effect: "Allow", Action: ["ecr:GetAuthorizationToken"], Resource: "*" });
  return out;
}

const ACCOUNT = "data.aws_caller_identity.current.account_id";

/** The trust policy. A role only ECS tasks assume carries the confused-deputy conditions of relations/assume-role.md (SEC-040). */
const trustPolicy = (principals: string[], ecsTask: false | string): Expr => ({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: principals.length === 1 ? principals[0]! : principals },
      Action: "sts:AssumeRole",
      ...(ecsTask
        ? { Condition: { StringEquals: { "aws:SourceAccount": ref(ACCOUNT) }, ArnLike: { "aws:SourceArn": template(`arn:aws:ecs:${ecsTask}:\${${ACCOUNT}}:*`) } } }
        : {}),
    },
  ],
});

export function planIam(c: PlanCtx): void {
  const { g, add } = c;
  for (const role of g.nodesOf("iam-role")) {
    if (!isEmitted(g, role)) continue;
    const principals = [...new Set(g.consumersOf(role.key).flatMap((x) => (x.slot ? [slotFor(x.consumer.service, x.slot)?.trust] : [])).filter((x): x is string => !!x))].sort();
    const name = roleNameOf(role);
    const consumers = g.consumersOf(role.key);
    const ecsTask = consumers.every((x) => x.consumer.service === "ecs" && x.slot === "task") ? c.nd.settings.region : false;
    if (ecsTask) c.once("identity", () => add("iam.tf", { type: "data", labels: ["aws_caller_identity", "current"], args: [] }, role.key));
    add("iam.tf", resource("aws_iam_role", role.key, [["name", name], ["assume_role_policy", call("jsonencode", trustPolicy(principals, ecsTask))], c.tags(role)]), role.key);
    for (const arn of managedOf(g, role)) {
      add("iam.tf", resource("aws_iam_role_policy_attachment", attachmentName(role.key, arn), [["role", ref(`aws_iam_role.${role.key}.name`)], ["policy_arn", arn]]), role.key);
    }
    const statements = statementsOf(g, role);
    if (statements.length) {
      const policy = { Version: "2012-10-17", Statement: statements.map((s) => ({ ...s, Resource: s.Resource })) } as unknown as Expr;
      add("iam.tf", resource("aws_iam_role_policy", `${role.key}_grants`, [["name", "grants"], ["role", ref(`aws_iam_role.${role.key}.id`)], ["policy", call("jsonencode", policy)]]), role.key);
    }
    for (const p of policiesOf(g, role.key)) {
      add("iam.tf", resource("aws_iam_role_policy_attachment", `${role.key}_${p.key}`, [["role", ref(`aws_iam_role.${role.key}.name`)], ["policy_arn", ref(`aws_iam_policy.${p.key}.arn`)]]), role.key);
    }
    const raw = role.props.raw_policy;
    if (raw !== undefined && raw !== null && raw !== "") {
      const doc = (typeof raw === "string" ? JSON.parse(raw) : raw) as Value;
      add("iam.tf", resource("aws_iam_role_policy", `${role.key}_raw`, [["name", "raw"], ["role", ref(`aws_iam_role.${role.key}.id`)], ["policy", call("jsonencode", toExpr(doc))]]), role.key);
    }
  }
  for (const p of g.nodesOf("iam-policy")) {
    const doc = (typeof p.props.policy === "string" ? JSON.parse(p.props.policy) : p.props.policy) as Value;
    const args: [string, Expr][] = [["name", policyNameOf(p)], ...c.optional(p, ["description"]), ["policy", call("jsonencode", toExpr(doc))], c.tags(p)];
    add("iam.tf", resource("aws_iam_policy", p.key, args), p.key);
  }
  for (const e of g.edges("assume-role")) {
    const consumer = g.node(e.to);
    if (consumer?.service !== "ec2") continue;
    add("iam.tf", resource("aws_iam_instance_profile", consumer.key, [["name", consumer.key.replace(/_/g, "-")], ["role", ref(`aws_iam_role.${e.from}.name`)]]), e.id);
  }
}

export type { Block };
export { MANAGED, SLOTS };

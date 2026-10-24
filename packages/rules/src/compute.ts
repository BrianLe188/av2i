import { hit, type RuleImpl } from "./context.ts";

export const VAL_021: RuleImpl = (ctx) =>
  [...ctx.facts.workloads.keys()].filter((w) => ctx.g.securityGroupsOf(w).length > ctx.limits.securityGroupsPerInterface).map((w) => hit(w));

/** Workloads and databases all need an explicit security group (decision D-005). */
export const VAL_029: RuleImpl = (ctx) =>
  [...ctx.facts.workloads.keys(), ...ctx.g.nodesOf("rds").map((d) => d.key)].filter((w) => ctx.g.securityGroupsOf(w).length === 0).map((w) => hit(w));

const FAMILIES = ["amazon-linux-2023", "ubuntu-24-04"];
/** An AMI is written, or the family to look one up in is known (the family defaults to Amazon Linux 2023). */
const hasImage = (p: Record<string, unknown>) => (typeof p.ami === "string" && p.ami !== "") || p.ami_family === undefined || FAMILIES.includes(String(p.ami_family));

export const VAL_030: RuleImpl = (ctx) =>
  ctx.g.nodesOf("ec2").filter((n) => !hasImage(n.props) || !n.props.instance_type || ctx.g.parentOf(n.key)?.service !== "subnet").map((n) => hit(n.key));

export const VAL_031: RuleImpl = (ctx) =>
  ctx.g.nodesOf("ec2").filter((n) => { const f = ctx.facts.workloads.get(n.key); const s = f?.subnet ? ctx.facts.subnets.get(f.subnet) : undefined; return !!f?.publicAddress && !s?.public; }).map((n) => hit(n.key));

export const VAL_032: RuleImpl = (ctx) =>
  [...ctx.facts.workloads].filter(([k, f]) => ctx.g.node(k)?.service === "ec2" && !f.internetEgress).map(([k]) => hit(k));

export const SEC_006: RuleImpl = (ctx) =>
  ctx.g.nodesOf("ec2").filter((n) => ctx.g.prop(n.key, "metadata_options.http_tokens") !== "required").map((n) => hit(n.key));

export const SEC_007: RuleImpl = (ctx) =>
  ctx.g.nodesOf("ec2").filter((n) => ctx.g.prop(n.key, "root_block_device.encrypted") !== true).map((n) => hit(n.key));

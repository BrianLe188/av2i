import { hit, type Ctx, type RuleImpl } from "./context.ts";

const services = (ctx: Ctx) => ctx.g.nodesOf("ecs").filter((n) => n.props.part === "service");
const functions = (ctx: Ctx) => ctx.g.nodesOf("lambda");

/** CPU units to the memory (MiB) Fargate accepts with them (services/ecs.md, fargate_task_size). */
function memories(cpu: string): number[] | null {
  const range = (from: number, to: number, step: number) => Array.from({ length: (to - from) / step + 1 }, (_, i) => from + i * step);
  switch (cpu) {
    case "256": return [512, 1024, 2048];
    case "512": return range(1024, 4096, 1024);
    case "1024": return range(2048, 8192, 1024);
    case "2048": return range(4096, 16384, 1024);
    case "4096": return range(8192, 30720, 1024);
    case "8192": return range(16384, 61440, 4096);
    case "16384": return range(32768, 122880, 8192);
    case "32768": return [61440, 122880, 249856];
    default: return null;
  }
}

export const VAL_040: RuleImpl = (ctx) =>
  services(ctx).filter((s) => {
    const ok = memories(String(s.props.cpu ?? "256"));
    return !ok || !ok.includes(Number(s.props.memory ?? "512"));
  }).map((s) => hit(s.key));

export const VAL_041: RuleImpl = (ctx) =>
  services(ctx).filter((s) => {
    const subnets = ctx.g.subnetsOf(s.key);
    const groups = ctx.g.securityGroupsOf(s.key);
    const vpcs = new Set([...subnets, ...groups].map((n) => ctx.g.vpcOf(n.key)?.key));
    return subnets.length < 1 || subnets.length > 16 || groups.length < 1 || groups.length > 5 || vpcs.size > 1;
  }).map((s) => hit(s.key));

export const VAL_042: RuleImpl = (ctx) =>
  services(ctx).filter((s) => ctx.g.imageOf(s.key) && ctx.facts.workloads.get(s.key)?.internetEgress === false).map((s) => hit(s.key));

export const VAL_044: RuleImpl = (ctx) =>
  services(ctx).filter((s) => !ctx.g.rolesOf(s.key).some((r) => r.slot === "execution")).map((s) => hit(s.key));

export const VAL_045: RuleImpl = (ctx) =>
  services(ctx).filter((s) => s.props.assign_public_ip === true && !ctx.g.subnetsOf(s.key).every((n) => ctx.facts.subnets.get(n.key)?.public)).map((s) => hit(s.key));

export const VAL_046: RuleImpl = (ctx) =>
  services(ctx).filter((s) => (s.props.launch_type !== undefined && s.props.capacity_provider_strategy !== undefined) || (s.props.launch_type !== undefined && s.props.launch_type !== "FARGATE")).map((s) => hit(s.key));

export const VAL_048: RuleImpl = (ctx) =>
  services(ctx).filter((s) => {
    const c = typeof s.props.cluster === "string" ? ctx.g.node(s.props.cluster) : undefined;
    return !c || c.service !== "ecs" || c.props.part !== "cluster";
  }).map((s) => hit(s.key));

export const SEC_011: RuleImpl = (ctx) => services(ctx).filter((s) => s.props.assign_public_ip === true).map((s) => hit(s.key));

/** Fargate services and VPC-attached functions should span two Availability Zones. */
export const VAL_037: RuleImpl = (ctx) =>
  [...services(ctx), ...functions(ctx).filter((f) => ctx.g.subnetsOf(f.key).length > 0)].filter((w) => {
    const zones = new Set(ctx.g.subnetsOf(w.key).map((s) => s.props.availability_zone).filter((a) => typeof a === "string"));
    return zones.size < 2;
  }).map((w) => hit(w.key));

export const VAL_033: RuleImpl = (ctx) =>
  functions(ctx).filter((f) => {
    const p = f.props;
    const image = !!ctx.g.imageOf(f.key);
    const present = [typeof p.filename === "string" && p.filename !== "", typeof p.s3_bucket === "string" && p.s3_bucket !== "", image];
    if (present.filter(Boolean).length !== 1) return true;
    if (typeof p.s3_bucket === "string" && p.s3_bucket !== "" && !p.s3_key) return true;
    if (!image && (!p.handler || !p.runtime)) return true;
    return image && (p.handler !== undefined || p.runtime !== undefined);
  }).map((f) => hit(f.key));

export const VAL_034: RuleImpl = (ctx) =>
  functions(ctx).filter((f) => {
    const p = f.props;
    const within = (v: unknown, lo: number, hi: number) => v === undefined || (typeof v === "number" && v >= lo && v <= hi);
    const env = p.environment_variables;
    const envSize = env !== null && typeof env === "object" && !Array.isArray(env) ? Object.entries(env).reduce((n, [k, v]) => n + k.length + String(v).length, 0) : 0;
    return !within(p.memory_size, 128, 10240) || !within(p.timeout, 1, 900) || !within(p.ephemeral_storage_size, 512, 10240) || (Array.isArray(p.layers) && p.layers.length > 5) || envSize > 4096;
  }).map((f) => hit(f.key));

/** Subnets or groups without the other half, which Lambda treats as a half-written VPC configuration. */
export const VAL_036: RuleImpl = (ctx) =>
  functions(ctx).filter((f) => (ctx.g.subnetsOf(f.key).length > 0) !== (ctx.g.securityGroupsOf(f.key).length > 0)).map((f) => hit(f.key));

export const VAL_038: RuleImpl = (ctx) =>
  functions(ctx).filter((f) => ctx.g.subnetsOf(f.key).some((s) => ctx.facts.subnets.get(s.key)?.public)).map((f) => hit(f.key));

export const VAL_039: RuleImpl = (ctx) =>
  functions(ctx).filter((f) => ctx.g.subnetsOf(f.key).some((s) => ctx.g.vpcOf(s.key)?.props.instance_tenancy === "dedicated")).map((f) => hit(f.key));

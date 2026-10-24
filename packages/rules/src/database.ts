import { servicePort } from "@av2i/engine";
import { effectiveIngress } from "@av2i/engine";
import { hit, type Ctx, type RuleImpl } from "./context.ts";

const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const dbs = (ctx: Ctx) => ctx.g.nodesOf("rds");

const azs = (ctx: Ctx, key: string) => new Set(ctx.g.subnetsOf(key).map((s) => text(s.props.availability_zone)).filter((a): a is string => !!a));

/** Anything that fails here is also reported by the more specific rules; this one counts the group, not the instance. */
export const VAL_058: RuleImpl = (ctx) =>
  dbs(ctx).filter((d) => {
    const subnets = ctx.g.subnetsOf(d.key);
    const vpcs = new Set(subnets.map((s) => ctx.g.vpcOf(s.key)?.key));
    return subnets.length < 2 || subnets.length > 20 || vpcs.size > 1 || azs(ctx, d.key).size < 2;
  }).map((d) => hit(d.key, ...ctx.g.subnetsOf(d.key).map((s) => s.key)));

export const VAL_059: RuleImpl = (ctx) =>
  dbs(ctx).filter((d) => {
    const id = text(d.props.identifier);
    return id !== undefined && !(/^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(id) && !id.endsWith("-") && !id.includes("--"));
  }).map((d) => hit(d.key));

export const VAL_060: RuleImpl = (ctx) =>
  dbs(ctx).filter((d) => {
    const p = d.props;
    const hasPassword = typeof p.password === "string" && p.password !== "";
    const managed = p.manage_master_user_password !== false;
    return !p.engine || !p.instance_class || typeof p.allocated_storage !== "number" || !p.username || ctx.g.subnetsOf(d.key).length === 0 || !(hasPassword || managed);
  }).map((d) => hit(d.key));

export const VAL_061: RuleImpl = (ctx) =>
  dbs(ctx).filter((d) => {
    const pw = text(d.props.password);
    if (pw === undefined || pw === "") return false;
    const max = d.props.engine === "mysql" ? 41 : 128;
    return pw.length < 8 || pw.length > max || /[^\x21-\x7e]/.test(pw) || /[/'"@]/.test(pw);
  }).map((d) => hit(d.key));

export const VAL_062: RuleImpl = (ctx) =>
  dbs(ctx).filter((d) => {
    if (d.props.publicly_accessible !== true) return false;
    const subnets = ctx.g.subnetsOf(d.key);
    const allPublic = subnets.length > 0 && subnets.every((s) => ctx.facts.subnets.get(s.key)?.public);
    const vpc = ctx.g.vpcOf(subnets[0]?.key ?? "");
    const dns = vpc?.props.enable_dns_support !== false && vpc?.props.enable_dns_hostnames === true;
    return !allPublic || !dns;
  }).map((d) => hit(d.key));

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** A window as intervals of minutes in the week; a daily window (`hh:mm-hh:mm`) repeats on every day. */
function intervals(window: string): [number, number][] | null {
  const week = 7 * 1440;
  const span = (start: number, end: number): [number, number][] => {
    const to = end <= start ? end + week : end;
    return to > week ? [[start, week], [0, to - week]] : [[start, to]];
  };
  const daily = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(window);
  if (daily) {
    const a = Number(daily[1]) * 60 + Number(daily[2]);
    const b = Number(daily[3]) * 60 + Number(daily[4]);
    return DAYS.flatMap((_, d) => span(d * 1440 + a, d * 1440 + b));
  }
  const weekly = /^([a-z]{3}):(\d{2}):(\d{2})-([a-z]{3}):(\d{2}):(\d{2})$/i.exec(window);
  if (weekly) {
    const d1 = DAYS.indexOf(weekly[1]!.toLowerCase());
    const d2 = DAYS.indexOf(weekly[4]!.toLowerCase());
    if (d1 < 0 || d2 < 0) return null;
    return span(d1 * 1440 + Number(weekly[2]) * 60 + Number(weekly[3]), d2 * 1440 + Number(weekly[5]) * 60 + Number(weekly[6]));
  }
  return null;
}

export const VAL_063: RuleImpl = (ctx) =>
  dbs(ctx).filter((d) => {
    const days = d.props.backup_retention_period;
    if (days !== undefined && (typeof days !== "number" || days < 0 || days > 35)) return true;
    const b = text(d.props.backup_window);
    const m = text(d.props.maintenance_window);
    if (!b || !m) return false;
    const a = intervals(b);
    const c = intervals(m);
    if (!a || !c) return true;
    return a.some(([s1, e1]) => c.some(([s2, e2]) => s1 < e2 && s2 < e1));
  }).map((d) => hit(d.key));

export const VAL_064: RuleImpl = (ctx) =>
  dbs(ctx).filter((d) => {
    if (d.props.skip_final_snapshot === true) return false;
    const id = text(d.props.final_snapshot_identifier);
    // left empty, the generator derives a valid one from the instance identifier
    return id !== undefined && !(/^[A-Za-z][A-Za-z0-9-]*$/.test(id) && !id.endsWith("-") && !id.includes("--"));
  }).map((d) => hit(d.key));

export const VAL_065: RuleImpl = (ctx) =>
  dbs(ctx).filter((d) => typeof d.props.max_allocated_storage === "number" && d.props.max_allocated_storage > 0 && typeof d.props.allocated_storage === "number" && d.props.max_allocated_storage < d.props.allocated_storage).map((d) => hit(d.key));

export const VAL_067: RuleImpl = (ctx) => dbs(ctx).filter((d) => d.props.multi_az === true && azs(ctx, d.key).size < 2).map((d) => hit(d.key));

export const VAL_069: RuleImpl = (ctx) =>
  dbs(ctx).filter((d) => d.props.manage_master_user_password === true && typeof d.props.password === "string" && d.props.password !== "").map((d) => hit(d.key));

export const VAL_068: RuleImpl = (ctx) =>
  ctx.g.edges("network-access").filter((e) => {
    const port = servicePort(ctx.g, e.to);
    return ctx.g.node(e.to)?.service === "rds" && typeof e.props?.port === "number" && port !== undefined && e.props.port !== port;
  }).map((e) => hit(e.from, e.to));

export const SEC_017: RuleImpl = (ctx) => dbs(ctx).filter((d) => d.props.publicly_accessible === true).map((d) => hit(d.key));
export const SEC_018: RuleImpl = (ctx) => dbs(ctx).filter((d) => d.props.storage_encrypted === false).map((d) => hit(d.key));
export const SEC_019: RuleImpl = (ctx) => dbs(ctx).filter((d) => d.props.deletion_protection !== true).map((d) => hit(d.key));
export const SEC_020: RuleImpl = (ctx) => dbs(ctx).filter((d) => typeof d.props.password === "string" && d.props.password !== "").map((d) => hit(d.key));
export const SEC_021: RuleImpl = (ctx) => dbs(ctx).filter((d) => d.props.backup_retention_period === 0).map((d) => hit(d.key));
export const SEC_022: RuleImpl = (ctx) => dbs(ctx).filter((d) => d.props.skip_final_snapshot === true).map((d) => hit(d.key));

export const SEC_023: RuleImpl = (ctx) => {
  const out = [];
  for (const d of dbs(ctx)) {
    const port = servicePort(ctx.g, d.key)!;
    for (const sg of ctx.g.securityGroupsOf(d.key)) {
      const open = effectiveIngress(ctx.g, sg.key).some((r) => {
        if (r.cidr_ipv4 !== "0.0.0.0/0" && r.cidr_ipv6 !== "::/0") return false;
        return r.ip_protocol === "-1" || (r.from_port !== undefined && r.to_port !== undefined && r.from_port <= port && port <= r.to_port);
      });
      if (open) out.push(hit(d.key, sg.key));
    }
  }
  return out;
};

import { hit, type RuleImpl } from "./context.ts";

export const VAL_128: RuleImpl = (ctx) =>
  ctx.g.nodesOf("elastic-ip").filter((e) => ctx.g.edges("eip-attach").every((x) => x.from !== e.key)).map((e) => hit(e.key));

export const VAL_129: RuleImpl = (ctx) => {
  const out = [];
  for (const e of ctx.g.nodesOf("elastic-ip")) {
    const targets = ctx.g.edges("eip-attach").filter((x) => x.from === e.key).map((x) => x.to);
    if (targets.length > 1) out.push(hit(e.key, ...targets));
  }
  return out;
};

export const VAL_130: RuleImpl = (ctx) => {
  const out = [];
  const all = ctx.g.nodesOf("elastic-ip");
  if (all.length > ctx.limits.eipsPerRegion) out.push(hit(...all.map((e) => e.key)));
  for (const nat of ctx.g.nodesOf("nat-gateway")) {
    const eips = ctx.g.elasticIpsOf(nat.key);
    if (eips.length > ctx.limits.eipsPerNat) out.push(hit(nat.key, ...eips.map((e) => e.key)));
  }
  return out;
};

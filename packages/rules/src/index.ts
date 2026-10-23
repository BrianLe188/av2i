import type { Registry, RuleId } from "@av2i/registry";
import { normalize } from "@av2i/engine";
import type { Design, Finding } from "@av2i/model";
import { makeContext, toFinding, type RuleImpl } from "./context.ts";
import * as network from "./network.ts";
import * as securitygroup from "./securitygroup.ts";
import * as compute from "./compute.ts";
import * as elasticip from "./elasticip.ts";

export type { Ctx, Hit, RuleImpl } from "./context.ts";

/** `VAL_001` in a module becomes the rule ID `VAL-001`. */
function collect(...modules: Record<string, unknown>[]): Partial<Record<RuleId, RuleImpl>> {
  const out: Record<string, RuleImpl> = {};
  for (const m of modules) for (const [name, fn] of Object.entries(m)) if (/^(VAL|SEC)_\d{3}$/.test(name)) out[name.replace("_", "-")] = fn as RuleImpl;
  return out as Partial<Record<RuleId, RuleImpl>>;
}

export const implementations = collect(network, securitygroup, compute, elasticip);

export function runRules(design: Design, registry: Registry): Finding[] {
  const ctx = makeContext(normalize(design));
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const id of Object.keys(implementations).sort() as RuleId[]) {
    for (const h of implementations[id]!(ctx)) {
      const key = `${id}|${[...h.targets].sort().join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(toFinding(registry, id, h));
    }
  }
  return findings;
}

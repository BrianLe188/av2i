import type { Registry } from "@av2i/registry";
import type { Finding, NormalizedDesign } from "@av2i/model";
import { computeFacts, Graph, type Facts } from "@av2i/engine";
import type { RuleId } from "@av2i/registry";

export interface Ctx {
  g: Graph;
  facts: Facts;
  region: string;
  limits: { eipsPerRegion: number; eipsPerNat: number; securityGroupsPerInterface: number };
}

/** What a rule reports: the nodes (and edges) to highlight. Severity, message and fix come from the registry. */
export interface Hit {
  targets: string[];
}

export type RuleImpl = (ctx: Ctx) => Hit[];

export function makeContext(nd: NormalizedDesign): Ctx {
  const g = new Graph(nd);
  return { g, facts: computeFacts(g), region: nd.settings.region, limits: { eipsPerRegion: 5, eipsPerNat: 2, securityGroupsPerInterface: 5 } };
}

export const hit = (...targets: string[]): Hit => ({ targets });

export function toFinding(registry: Registry, rule: RuleId, h: Hit): Finding {
  const r = registry.rules[rule]!;
  return { rule, severity: r.severity, targets: h.targets, message: r.message, fix: r.fix };
}

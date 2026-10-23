import type { Registry } from "@av2i/registry";
import { checkDesign, type Design, type Finding, type NormalizedDesign } from "@av2i/model";
import { normalize } from "@av2i/engine";
import { runRules } from "@av2i/rules";
import { generate, plan, printBlocks, type PlannedResource } from "@av2i/generator";

export interface PlannedText {
  file: string;
  /** the node or edge that caused the resource */
  from: string;
  address: string;
  text: string;
}

export interface Analysis {
  structural: { where: string; message: string }[];
  findings: Finding[];
  normalized: NormalizedDesign | null;
  /** null while the design has an error */
  files: Record<string, string> | null;
  resources: PlannedText[];
}

const none: Analysis = { structural: [], findings: [], normalized: null, files: null, resources: [] };

export function analyze(design: Design, reg: Registry): Analysis {
  const structural = checkDesign(design, reg);
  if (structural.length) return { ...none, structural };
  try {
    const findings = runRules(design, reg);
    const normalized = normalize(design);
    if (findings.some((f) => f.severity === "error")) return { ...none, findings, normalized };
    const planned: PlannedResource[] = plan(design);
    return {
      ...none,
      findings,
      normalized,
      files: generate(design),
      resources: planned.map((p) => ({ file: p.file, from: p.from, address: p.block.labels.join("."), text: printBlocks([p.block]) })),
    };
  } catch (e) {
    return { ...none, structural: [{ where: "engine", message: e instanceof Error ? e.message : String(e) }] };
  }
}

const RANK = { error: 3, warning: 2, info: 1 } as const;

/** The worst severity per node key, for the badges on the canvas. */
export function worstByNode(findings: readonly Finding[]): Map<string, Finding["severity"]> {
  const out = new Map<string, Finding["severity"]>();
  for (const f of findings) for (const t of f.targets) {
    const cur = out.get(t);
    if (!cur || RANK[f.severity] > RANK[cur]) out.set(t, f.severity);
  }
  return out;
}

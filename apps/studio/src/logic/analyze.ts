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
  /**
   * The Terraform for the design. It exists whenever it can be written, also while rules report errors: then it is a preview
   * (`errors` > 0) that may be missing or wrong where the errors are. null when the design is too broken to write any.
   */
  files: Record<string, string> | null;
  resources: PlannedText[];
  /** how many findings are errors; a design with errors can be previewed but not exported */
  errors: number;
  /** why no Terraform could be written, when `files` is null and the structure was fine */
  generateError: string | null;
}

const none: Analysis = { structural: [], findings: [], normalized: null, files: null, resources: [], errors: 0, generateError: null };

export function analyze(design: Design, reg: Registry): Analysis {
  const structural = checkDesign(design, reg);
  if (structural.length) return { ...none, structural };
  try {
    const findings = runRules(design, reg);
    const normalized = normalize(design);
    const errors = findings.filter((f) => f.severity === "error").length;
    try {
      const planned: PlannedResource[] = plan(design);
      return {
        ...none,
        findings,
        normalized,
        errors,
        files: generate(design),
        resources: planned.map((p) => ({ file: p.file, from: p.from, address: p.block.labels.join("."), text: printBlocks([p.block]) })),
      };
    } catch (e) {
      // a design with errors may be incomplete in a way the generator cannot write; say why instead of showing nothing
      if (errors === 0) throw e;
      return { ...none, findings, normalized, errors, generateError: e instanceof Error ? e.message : String(e) };
    }
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

import { getRegistry } from "@av2i/registry";
import { applyPatch, checkDesign, type Design, type PatchOp } from "@av2i/model";
import { runRules } from "@av2i/rules";

export interface ScenarioVariant {
  id: string;
  change: string;
  patch?: PatchOp[];
  fires: string[];
  /** findings of the base design the change removes */
  clears?: string[];
  severity: string;
}

export interface ExecutableScenario {
  id: string;
  design: Design;
  expect: { errors: string[]; findings: string[] };
  variants: ScenarioVariant[];
}

export function executableScenarios(): ExecutableScenario[] {
  return Object.values(getRegistry().scenarios)
    .filter((s) => s.executable === true)
    .map((s) => s as unknown as ExecutableScenario);
}

/** Rule IDs a design fires, sorted and de-duplicated. */
export function firedRules(design: Design): string[] {
  const registry = getRegistry();
  return [...new Set(runRules(design, registry).map((f) => f.rule))].sort();
}

export function structuralProblems(design: Design): string[] {
  return checkDesign(design, getRegistry()).map((p) => `${p.where}: ${p.message}`);
}

export { applyPatch };

export interface ExecutableCase {
  rule: string;
  name: string;
  fires: boolean;
  base: string;
  patch: PatchOp[];
}

/** Cases of rules/cases.md that carry a patch, with the base design they patch. */
export function executableCases(): ExecutableCase[] {
  return getRegistry().cases.flatMap((g) =>
    g.cases.filter((c) => c.patch).map((c) => ({ rule: g.rule, name: c.name, fires: c.fires, base: c.base ?? "ec2-in-vpc", patch: c.patch as PatchOp[] })),
  );
}

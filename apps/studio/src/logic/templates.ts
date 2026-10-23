import type { Registry } from "@av2i/registry";
import { applyPatch, type Design, type PatchOp } from "@av2i/model";
import { withPositions } from "./layout.ts";

export interface Template {
  id: string;
  title: { vi: string; en: string };
  variants: { id: string; change: string }[];
}

export const blankDesign = (region = "ap-southeast-1"): Design => ({ schema: 1, name: "untitled", settings: { region }, nodes: [], edges: [] });

export function templates(reg: Registry): Template[] {
  return Object.values(reg.scenarios)
    .filter((s) => s.executable === true)
    .map((s) => ({ id: s.id as string, title: s.title as Template["title"], variants: ((s.variants ?? []) as { id: string; change: string }[]).map((v) => ({ id: v.id, change: v.change })) }));
}

export function fromTemplate(reg: Registry, id: string, variant?: string): Design {
  const s = reg.scenarios[id];
  if (!s) throw new Error(`no template ${id}`);
  let d = structuredClone(s.design) as Design;
  if (variant) {
    const v = (s.variants as { id: string; patch?: PatchOp[] }[]).find((x) => x.id === variant);
    if (!v?.patch) throw new Error(`no variant ${variant}`);
    d = applyPatch(d, v.patch);
  }
  return withPositions(d);
}

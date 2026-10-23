import type { Registry } from "@av2i/registry";
import type { Design } from "./types.ts";

export interface StructuralProblem {
  where: string;
  message: string;
}

const KEY = /^[a-z][a-z0-9_]*$/;

/**
 * Structural checks that run before any rule: keys, known services and mechanisms, parents the containment table allows,
 * edges the matrix allows in their own direction, and property keys the service defines. Rules assume these hold.
 */
export function checkDesign(design: Design, registry: Registry): StructuralProblem[] {
  const out: StructuralProblem[] = [];
  const add = (where: string, message: string) => out.push({ where, message });
  if (design.schema !== 1) add("design", `unknown schema version ${String(design.schema)}`);
  if (!design.settings?.region) add("settings", "region is required");

  const byKey = new Map<string, Design["nodes"][number]>();
  for (const n of design.nodes) {
    if (!KEY.test(n.key)) add(n.key, "key must match [a-z][a-z0-9_]*");
    if (byKey.has(n.key)) add(n.key, "duplicate key");
    byKey.set(n.key, n);
  }

  const cell = new Map(registry.matrix.pairs.map((p) => [`${p.from}>${p.to}`, p]));

  for (const n of design.nodes) {
    const svc = registry.services[n.service];
    if (!svc) { add(n.key, `unknown service ${n.service}`); continue; }
    if (n.parent) {
      const parent = byKey.get(n.parent);
      if (!parent) add(n.key, `parent ${n.parent} does not exist`);
      else {
        // a placement mechanism, drawn parent to child or child to parent (nat-placement runs from the gateway to its subnet)
        const placement = ["containment", "igw-attach", "nat-placement"];
        const ok = [cell.get(`${parent.service}>${n.service}`), cell.get(`${n.service}>${parent.service}`)].some(
          (c) => c && placement.includes(c.mechanism) && (c.value === "valid" || c.value === "conditional"),
        );
        if (!ok) {
          add(n.key, `a ${n.service} cannot be placed in a ${parent.service}`);
        }
      }
    }
    const known = new Map<string, any>(((svc.properties ?? []) as { key: string; type?: string }[]).map((p) => [p.key, p]));
    if (known.size) {
      for (const k of Object.keys(n.props)) {
        const def = known.get(k);
        if (!def) add(n.key, `${n.service} has no property ${k}`);
        else if (def.type === "reference") add(n.key, `property ${k} is set through the parent or a connection, not directly`);
      }
    }
  }

  const ids = new Set<string>();
  for (const e of design.edges) {
    if (ids.has(e.id)) add(e.id, "duplicate edge id");
    ids.add(e.id);
    const a = byKey.get(e.from);
    const b = byKey.get(e.to);
    if (!registry.mechanisms[e.mechanism]) { add(e.id, `unknown mechanism ${e.mechanism}`); continue; }
    if (!a || !b) { add(e.id, `${e.from} -> ${e.to} names a missing node`); continue; }
    const c = cell.get(`${a.service}>${b.service}`);
    if (!c || (c.value !== "valid" && c.value !== "conditional")) add(e.id, `${a.service} -> ${b.service} is ${c?.value ?? "missing"} in the matrix`);
    else if (c.mechanism !== e.mechanism) add(e.id, `${a.service} -> ${b.service} is connected through ${c.mechanism}, not ${e.mechanism}`);
  }
  return out;
}

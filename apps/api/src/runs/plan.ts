export interface PlannedChange {
  address: string;
  type: string;
  actions: string[];
}

export interface PlanSummary {
  add: number;
  change: number;
  destroy: number;
  replace: number;
  /** something is deleted or replaced: applying needs the stronger permission (DD-023) */
  destructive: boolean;
  resources: PlannedChange[];
}

/** Reads `tofu show -json plan.bin`: what the plan will create, change, delete or replace. Anything that only reads or does nothing is left out. */
export function summarizePlan(plan: unknown): PlanSummary {
  const out: PlanSummary = { add: 0, change: 0, destroy: 0, replace: 0, destructive: false, resources: [] };
  const changes = (plan as { resource_changes?: { address: string; type: string; change?: { actions?: string[] } }[] } | null)?.resource_changes ?? [];
  for (const rc of changes) {
    const actions = rc.change?.actions ?? [];
    if (actions.every((a) => a === "no-op" || a === "read")) continue;
    const del = actions.includes("delete");
    const create = actions.includes("create");
    if (del && create) out.replace++;
    else if (del) out.destroy++;
    else if (create) out.add++;
    else out.change++;
    out.resources.push({ address: rc.address, type: rc.type, actions });
  }
  out.destructive = out.destroy + out.replace > 0;
  return out;
}

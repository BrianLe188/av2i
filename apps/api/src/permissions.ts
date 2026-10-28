import { ACTIONS, ACTION_GROUPS, evaluate, matchesAction, parseDocument, type Action, type Statement } from "@av2i/authz";

/** Where a set of statements came from: a policy (by name, maybe through a group), or permissions given straight to a user or a group. */
export interface Source {
  kind: "policy" | "direct";
  /** the policy's name; for direct permissions, empty */
  name: string;
  /** the group it reaches the person through, when it does */
  group?: string;
  statements: Statement[];
}

export interface EffectiveRow {
  action: Action;
  allowed: boolean;
  /** an explicit Deny wins over every Allow */
  denied: boolean;
  sources: { kind: Source["kind"]; name: string; group?: string; scoped: boolean }[];
}

export const sourceFrom = (kind: Source["kind"], name: string, document: unknown, group?: string): Source => {
  const p = parseDocument(document);
  return { kind, name, ...(group ? { group } : {}), statements: p.ok ? p.statements : [] };
};

/**
 * For every permission of the platform: whether these sources allow it on every resource of its kind, which of them say so, and whether a Deny
 * stops it. A source that allows it only on some resources is listed as `scoped` and does not count as allowing it everywhere.
 */
export function effectivePermissions(sources: Source[]): EffectiveRow[] {
  const all = sources.flatMap((s) => s.statements);
  const actions = ACTION_GROUPS.flatMap((g) => [...g.actions]);
  return actions.map((action) => {
    const res = ACTIONS[action];
    const decision = evaluate(all, { action, resource: res });
    const found: EffectiveRow["sources"] = [];
    for (const s of sources) {
      const allows = s.statements.filter((st) => st.effect === "Allow" && st.actions.some((p) => matchesAction(p, action)));
      if (allows.length === 0) continue;
      const everywhere = evaluate(allows, { action, resource: res }).allowed;
      found.push({ kind: s.kind, name: s.name, ...(s.group ? { group: s.group } : {}), scoped: !everywhere });
    }
    return { action, allowed: decision.allowed, denied: decision.reason === "explicit-deny", sources: found };
  });
}

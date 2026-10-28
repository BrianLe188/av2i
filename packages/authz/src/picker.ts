import { ACTIONS, matchesAction, type Action, type Statement } from "./policy.ts";
import { BUILTIN_POLICIES } from "./builtin.ts";

/** The permissions as a person picks them: in groups, in the order they read best. */
export const ACTION_GROUPS: readonly { id: "projects" | "runs" | "state" | "connections" | "users" | "groups" | "policies" | "audit"; actions: readonly Action[] }[] = [
  { id: "projects", actions: ["project:Create", "project:List", "project:Read", "project:Write", "project:Delete", "project:Share"] },
  { id: "runs", actions: ["run:Plan", "run:Approve", "run:Apply", "run:ApplyDestructive"] },
  { id: "state", actions: ["state:Read", "state:Write", "variable:Write"] },
  { id: "connections", actions: ["connection:Manage", "connection:Use"] },
  { id: "users", actions: ["user:Create", "user:List", "user:Read", "user:Update", "user:Disable", "user:ResetPassword"] },
  { id: "groups", actions: ["group:Manage"] },
  { id: "policies", actions: ["policy:Manage"] },
  { id: "audit", actions: ["audit:Read"] },
];

/** The permissions of the system, granted to a user or a group (DD-031): they belong to no particular project. */
export const SYSTEM_GROUPS: readonly { id: "projects" | "connections" | "users" | "groups" | "policies" | "audit"; actions: readonly Action[] }[] = [
  { id: "projects", actions: ["project:Create"] },
  { id: "connections", actions: ["connection:Manage", "connection:Use"] },
  { id: "users", actions: ["user:Create", "user:List", "user:Read", "user:Update", "user:Disable", "user:ResetPassword"] },
  { id: "groups", actions: ["group:Manage"] },
  { id: "policies", actions: ["policy:Manage"] },
  { id: "audit", actions: ["audit:Read"] },
];

/** The permissions of one project, granted to a member in that project (DD-031). */
export const PROJECT_GROUPS: readonly { id: "project" | "runs" | "state"; actions: readonly Action[] }[] = [
  { id: "project", actions: ["project:Read", "project:Write", "project:Delete", "project:Share"] },
  { id: "runs", actions: ["run:Plan", "run:Approve", "run:Apply", "run:ApplyDestructive"] },
  { id: "state", actions: ["state:Read", "state:Write", "variable:Write"] },
];

/** Permissions to hand out with care: they delete, change infrastructure, state or who may do what. */
export const SENSITIVE: ReadonlySet<Action> = new Set<Action>([
  "project:Delete", "run:ApplyDestructive", "state:Write", "user:Disable", "user:ResetPassword", "group:Manage", "policy:Manage", "connection:Manage",
]);

/** What the Administrator policy must always allow, so that nobody can lock everyone out by editing it. */
export const ADMINISTRATOR_MUST_KEEP: readonly Action[] = ["policy:Manage", "user:List", "user:Read", "user:Update"];

export type Selection = { ok: true; all: boolean; actions: Action[] } | { ok: false; reason: string };

const known = Object.keys(ACTIONS) as Action[];

/**
 * Reads a policy document as a choice of permissions, when it is one: only Allow statements, each naming actions (a pattern such as `user:*`
 * stands for every action it matches) on every resource of their kind (or on `*`). A Deny or a statement limited to some resources is not a
 * choice of permissions and stays a matter for the JSON.
 */
export function selectionOf(statements: readonly Statement[]): Selection {
  const picked = new Set<Action>();
  let all = false;
  for (const s of statements) {
    if (s.effect !== "Allow") return { ok: false, reason: "deny" };
    const matched = known.filter((a) => s.actions.some((p) => matchesAction(p, a)));
    if (s.actions.includes("*") && s.resources.includes("*")) { all = true; matched.forEach((a) => picked.add(a)); continue; }
    for (const a of matched) {
      if (!s.resources.includes("*") && !s.resources.includes(ACTIONS[a])) return { ok: false, reason: "scoped" };
      picked.add(a);
    }
  }
  return { ok: true, all, actions: known.filter((a) => picked.has(a)) };
}

/** The document for a choice: everything (`*`), or the picked actions, one statement for each kind of resource. */
export function documentOf(actions: readonly Action[], all: boolean): { Statement: { Sid: string; Effect: "Allow"; Action: string[]; Resource: string[] }[] } {
  if (all) return { Statement: [{ Sid: "all", Effect: "Allow", Action: ["*"], Resource: ["*"] }] };
  const by = new Map<string, Action[]>();
  for (const a of known.filter((x) => actions.includes(x))) by.set(ACTIONS[a], [...(by.get(ACTIONS[a]) ?? []), a]);
  return { Statement: [...by.entries()].map(([res, list]) => ({ Sid: `allow-${res.slice("av2i:".length).replace(/[^a-z]/gi, "")}`, Effect: "Allow" as const, Action: list, Resource: [res] })) };
}

/** Whether two documents mean the same thing: the same choice when both are one, otherwise the same text. */
export function sameDocument(a: unknown, b: unknown, parse: (d: unknown) => { ok: true; statements: Statement[] } | { ok: false }): boolean {
  const pa = parse(a);
  const pb = parse(b);
  if (pa.ok && pb.ok) {
    const sa = selectionOf(pa.statements);
    const sb = selectionOf(pb.statements);
    if (sa.ok && sb.ok) return sa.all === sb.all && sa.actions.join() === sb.actions.join();
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The default document of a built-in policy, as the code ships it. */
export const defaultOf = (name: string) => BUILTIN_POLICIES.find((p) => p.name === name);

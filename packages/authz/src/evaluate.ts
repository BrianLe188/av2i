import { ACTIONS, matchesAction, matchesResource, resource, type Action, type Statement } from "./policy.ts";

export type Decision =
  | { allowed: true; reason: "allow"; sid?: string }
  | { allowed: false; reason: "explicit-deny" | "implicit-deny"; sid?: string };

const applies = (s: Statement, action: string, res: string) =>
  s.actions.some((a) => matchesAction(a, action)) && s.resources.some((r) => matchesResource(r, res));

/** A matching Deny refuses, a matching Allow permits, anything else is refused. */
export function evaluate(statements: readonly Statement[], request: { action: string; resource: string }): Decision {
  let allow: Statement | null = null;
  for (const s of statements) {
    if (!applies(s, request.action, request.resource)) continue;
    if (s.effect === "Deny") return { allowed: false, reason: "explicit-deny", ...(s.sid ? { sid: s.sid } : {}) };
    allow ??= s;
  }
  return allow ? { allowed: true, reason: "allow", ...(allow.sid ? { sid: allow.sid } : {}) } : { allowed: false, reason: "implicit-deny" };
}

export const can = (statements: readonly Statement[], action: Action, res: string) => evaluate(statements, { action, resource: res }).allowed;

/** Share roles on a project, added to the allows next to the person's policies; a Deny in the policies still wins. */
export const SHARE_ROLES = {
  viewer: ["project:Read"],
  editor: ["project:Read", "project:Write"],
} as const satisfies Record<string, readonly Action[]>;
export type ShareRole = keyof typeof SHARE_ROLES;

export const shareStatements = (role: ShareRole, projectId: string): Statement[] => [
  { sid: `share-${role}`, effect: "Allow", actions: [...SHARE_ROLES[role]], resources: [resource.project(projectId)] },
];

/** The owner may do everything with their project except create it (that is checked before it exists). */
export const ownerStatements = (projectId: string): Statement[] => [
  { sid: "owner", effect: "Allow", actions: ["project:Read", "project:Write", "project:Delete", "project:Share", "run:Plan", "run:Approve", "run:Apply", "state:Read"], resources: [resource.project(projectId)] },
];

/** Which actions the person may take on "any" resource of the kind: what the interface offers. The server decides every call again. */
export function allowedActions(statements: readonly Statement[]): Action[] {
  return (Object.keys(ACTIONS) as Action[]).filter((a) => can(statements, a, ACTIONS[a]));
}

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

/** The permissions that belong to one project: they are granted in the project, to a member, and the owner holds all of them (DD-028). */
export const PROJECT_ACTIONS = [
  "project:Read", "project:Write", "project:Delete", "project:Share",
  "run:Plan", "run:Approve", "run:Apply", "run:ApplyDestructive",
  "state:Read", "state:Write", "variable:Write",
] as const satisfies readonly Action[];
export type ProjectAction = (typeof PROJECT_ACTIONS)[number];

/** The roles a member can be given in a project; `custom` is any set of the project permissions that includes project:Read. */
export const PROJECT_ROLES = {
  viewer: ["project:Read"],
  editor: ["project:Read", "project:Write"],
  runner: ["project:Read", "run:Plan", "state:Read"],
  approver: ["project:Read", "run:Approve", "state:Read"],
  maintainer: ["project:Read", "project:Write", "project:Share", "run:Plan", "run:Approve", "run:Apply", "state:Read", "variable:Write"],
} as const satisfies Record<string, readonly ProjectAction[]>;
export const SHARE_ROLES = PROJECT_ROLES;
export type ShareRole = keyof typeof PROJECT_ROLES | "custom";

/** What a member's actions allow on one project, added to the allows next to the person's policies; a Deny in the policies still wins. */
export const memberStatements = (actions: readonly Action[], projectId: string, label: string = "custom"): Statement[] => [
  { sid: `member-${label}`, effect: "Allow", actions: [...actions], resources: [resource.project(projectId)] },
];

export const shareStatements = (role: keyof typeof PROJECT_ROLES, projectId: string): Statement[] => memberStatements(PROJECT_ROLES[role], projectId, role);

/** The owner holds every project permission (creating a project is checked before it exists). */
export const ownerStatements = (projectId: string): Statement[] => [
  { sid: "owner", effect: "Allow", actions: [...PROJECT_ACTIONS], resources: [resource.project(projectId)] },
];

/** Which actions the person may take on "any" resource of the kind: what the interface offers. The server decides every call again. */
export function allowedActions(statements: readonly Statement[]): Action[] {
  return (Object.keys(ACTIONS) as Action[]).filter((a) => can(statements, a, ACTIONS[a]));
}

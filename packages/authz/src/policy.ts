export type Effect = "Allow" | "Deny";

export interface Statement {
  sid?: string;
  effect: Effect;
  actions: string[];
  resources: string[];
}

/** Every action the platform checks, with the resource that stands for "any of them" (used for what the interface may offer). */
export const ACTIONS = {
  "project:Create": "av2i:project/*",
  "project:List": "av2i:project/*",
  "project:Read": "av2i:project/*",
  "project:Write": "av2i:project/*",
  "project:Delete": "av2i:project/*",
  "project:Share": "av2i:project/*",
  "user:Create": "av2i:user/*",
  "user:List": "av2i:user/*",
  "user:Read": "av2i:user/*",
  "user:Update": "av2i:user/*",
  "user:Disable": "av2i:user/*",
  "user:ResetPassword": "av2i:user/*",
  "group:Manage": "av2i:group/*",
  "policy:Manage": "av2i:policy/*",
  "audit:Read": "av2i:audit/*",
} as const;

export type Action = keyof typeof ACTIONS;

export const resource = {
  project: (id: string) => `av2i:project/${id}`,
  user: (id: string) => `av2i:user/${id}`,
  group: (id: string) => `av2i:group/${id}`,
  policy: (name: string) => `av2i:policy/${name}`,
  audit: () => "av2i:audit/*",
};

/** `*` matches any run of characters, everything else matches itself. */
function wildcard(pattern: string, flags = ""): RegExp {
  const escaped = pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${escaped}$`, flags);
}

export const matchesAction = (pattern: string, action: string) => wildcard(pattern, "i").test(action);
export const matchesResource = (pattern: string, res: string) => wildcard(pattern).test(res);

const asList = (v: unknown): string[] | null => {
  if (typeof v === "string") return [v];
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) return v as string[];
  return null;
};

export type Parsed = { ok: true; statements: Statement[] } | { ok: false; errors: string[] };

/**
 * Reads a policy document: `{ "Statement": [{ "Effect": "Allow", "Action": [...], "Resource": [...] }] }`.
 * An action must be `*` or match at least one known action, so a typo is an error instead of a statement that never applies.
 */
export function parseDocument(raw: unknown): Parsed {
  const errors: string[] = [];
  const doc = raw as { Statement?: unknown } | null;
  const list = doc && typeof doc === "object" && !Array.isArray(doc) ? doc.Statement : undefined;
  const raws = Array.isArray(list) ? list : list && typeof list === "object" ? [list] : null;
  if (!raws || raws.length === 0) return { ok: false, errors: ["the document needs a non-empty Statement"] };
  const statements: Statement[] = [];
  raws.forEach((s: unknown, i) => {
    const at = `Statement[${i}]`;
    const st = s as Record<string, unknown> | null;
    if (!st || typeof st !== "object") return void errors.push(`${at} must be an object`);
    const effect = st.Effect;
    if (effect !== "Allow" && effect !== "Deny") errors.push(`${at}.Effect must be Allow or Deny`);
    const actions = asList(st.Action);
    if (!actions) errors.push(`${at}.Action must be a string or a non-empty list of strings`);
    else for (const a of actions) {
      if (!Object.keys(ACTIONS).some((k) => matchesAction(a, k))) errors.push(`${at}.Action "${a}" matches no known action`);
    }
    const resources = asList(st.Resource);
    if (!resources) errors.push(`${at}.Resource must be a string or a non-empty list of strings`);
    else for (const r of resources) {
      if (r !== "*" && !r.startsWith("av2i:")) errors.push(`${at}.Resource "${r}" must be * or start with av2i:`);
    }
    const sid = st.Sid;
    if (sid !== undefined && typeof sid !== "string") errors.push(`${at}.Sid must be a string`);
    if ((effect === "Allow" || effect === "Deny") && actions && resources) statements.push({ ...(typeof sid === "string" ? { sid } : {}), effect, actions, resources });
  });
  return errors.length ? { ok: false, errors } : { ok: true, statements };
}

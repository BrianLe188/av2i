export interface BuiltinPolicy {
  name: string;
  description: string;
  document: { Statement: { Sid: string; Effect: "Allow"; Action: string[]; Resource: string[] }[] };
}

export const ADMINISTRATOR = "Administrator";

/** Read only in the database (`builtin`); the first start inserts them and later starts bring them up to date. */
export const BUILTIN_POLICIES: BuiltinPolicy[] = [
  {
    name: ADMINISTRATOR,
    description: "Everything, on every resource.",
    document: { Statement: [{ Sid: "all", Effect: "Allow", Action: ["*"], Resource: ["*"] }] },
  },
  {
    name: "ProjectEditor",
    description: "Create, list, read and change every project.",
    document: { Statement: [{ Sid: "projects", Effect: "Allow", Action: ["project:Create", "project:List", "project:Read", "project:Write"], Resource: ["av2i:project/*"] }] },
  },
  {
    name: "ProjectViewer",
    description: "List and read every project.",
    document: { Statement: [{ Sid: "projects", Effect: "Allow", Action: ["project:List", "project:Read"], Resource: ["av2i:project/*"] }] },
  },
  {
    name: "UserManager",
    description: "Create, change, disable and reset the passwords of users, and manage groups.",
    document: {
      Statement: [
        { Sid: "users", Effect: "Allow", Action: ["user:*"], Resource: ["av2i:user/*"] },
        { Sid: "groups", Effect: "Allow", Action: ["group:Manage"], Resource: ["av2i:group/*"] },
      ],
    },
  },
];

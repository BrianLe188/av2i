import type { ColumnType, Generated } from "kysely";

type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type TsNull = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;

export interface UsersTable {
  id: Generated<string>;
  username: string;
  display_name: Generated<string>;
  password_hash: string;
  must_change_password: Generated<boolean>;
  disabled: Generated<boolean>;
  failed_attempts: Generated<number>;
  locked_until: TsNull;
  password_changed_at: TsNull;
  last_login_at: TsNull;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: Buffer;
  created_at: Ts;
  last_seen_at: Ts;
  idle_expires_at: Ts;
  expires_at: Ts;
  revoked_at: TsNull;
  ip: string | null;
  user_agent: string | null;
}

export interface LoginThrottleTable {
  key: string;
  attempts: number;
  window_start: Ts;
  blocked_until: TsNull;
}

export interface GroupsTable {
  id: Generated<string>;
  name: string;
  description: Generated<string>;
  created_at: Ts;
}

export interface GroupMembersTable {
  group_id: string;
  user_id: string;
  added_at: Ts;
}

export interface PoliciesTable {
  id: Generated<string>;
  name: string;
  description: Generated<string>;
  document: ColumnType<unknown, string, string>;
  builtin: Generated<boolean>;
  created_at: Ts;
  updated_at: Ts;
}

export interface PolicyAttachmentsTable {
  id: Generated<string>;
  policy_id: string;
  user_id: string | null;
  group_id: string | null;
}

export interface AuditLogTable {
  id: Generated<string>;
  at: Ts;
  actor_id: string | null;
  actor_username: string | null;
  action: string;
  resource: string | null;
  outcome: "success" | "denied" | "failure";
  ip: string | null;
  details: ColumnType<Record<string, unknown>, string | undefined, string>;
}

export interface ProjectsTable {
  id: Generated<string>;
  name: string;
  owner_id: string;
  design: ColumnType<unknown, string, string>;
  rev: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;
  deleted_at: TsNull;
}

export interface ProjectVersionsTable {
  project_id: string;
  version: number;
  design: ColumnType<unknown, string, string>;
  note: Generated<string>;
  auto: Generated<boolean>;
  created_by: string | null;
  created_at: Ts;
}

export interface ProjectSharesTable {
  id: Generated<string>;
  project_id: string;
  user_id: string | null;
  group_id: string | null;
  role: "viewer" | "editor";
  granted_by: string | null;
  created_at: Ts;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  login_throttle: LoginThrottleTable;
  groups: GroupsTable;
  group_members: GroupMembersTable;
  policies: PoliciesTable;
  policy_attachments: PolicyAttachmentsTable;
  audit_log: AuditLogTable;
  projects: ProjectsTable;
  project_versions: ProjectVersionsTable;
  project_shares: ProjectSharesTable;
}

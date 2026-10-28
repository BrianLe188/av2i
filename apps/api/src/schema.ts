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
  connection_id: ColumnType<string | null, string | null | undefined, string | null>;
  request_seq: Generated<number>;
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

export interface ApiTokensTable {
  id: Generated<string>;
  user_id: string;
  name: string;
  token_hash: Buffer;
  prefix: string;
  actions: string[] | null;
  expires_at: TsNull;
  last_used_at: TsNull;
  last_used_ip: string | null;
  revoked_at: TsNull;
  created_at: Ts;
}

export interface RunsTable {
  id: Generated<string>;
  project_id: string;
  kind: "plan" | "apply";
  status: Generated<"queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted">;
  design: ColumnType<unknown, string, string>;
  design_hash: string;
  created_by: string | null;
  created_at: Ts;
  started_at: TsNull;
  finished_at: TsNull;
  error: string | null;
  summary: ColumnType<unknown, string | null | undefined, string | null>;
  plan_data: Buffer | null;
  plan_nonce: Buffer | null;
  plan_key_id: string | null;
  state_serial: number | null;
  state_token_hash: Buffer | null;
  variables_hash: ColumnType<string | null, string | null | undefined, string | null>;
  connection_id: ColumnType<string | null, string | null | undefined, string | null>;
  role_arn: ColumnType<string | null, string | null | undefined, string | null>;
  aws_account: ColumnType<string | null, string | null | undefined, string | null>;
  plan_run_id: ColumnType<string | null, string | null | undefined, string | null>;
  files_hash: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface RunLogsTable {
  run_id: string;
  seq: number;
  at: Ts;
  line: string;
}

export interface StateVersionsTable {
  id: Generated<number>;
  project_id: string;
  serial: number;
  lineage: string;
  key_id: string;
  nonce: Buffer;
  data: Buffer;
  run_id: string | null;
  created_at: Ts;
}

export interface StateLocksTable {
  project_id: string;
  lock_id: string;
  info: ColumnType<unknown, string, string>;
  run_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Ts;
}

export interface ProjectVariablesTable {
  project_id: string;
  name: string;
  key_id: string;
  nonce: Buffer;
  data: Buffer;
  updated_by: string | null;
  updated_at: Ts;
}

export interface AwsConnectionsTable {
  id: Generated<string>;
  name: string;
  description: Generated<string>;
  plan_role_arn: string;
  apply_role_arn: string | null;
  external_id: string;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  last_test_at: TsNull;
  last_test: ColumnType<unknown, string | null | undefined, string | null>;
}

export interface RequestsTable {
  id: Generated<string>;
  project_id: string;
  number: number;
  kind: "apply";
  plan_run_id: ColumnType<string | null, string | null | undefined, string | null>;
  status: Generated<"waiting" | "approved" | "applied" | "closed">;
  close_reason: ColumnType<"rejected" | "withdrawn" | null, "rejected" | "withdrawn" | null | undefined, "rejected" | "withdrawn" | null>;
  requester_id: string | null;
  requester: string;
  decided_by_id: ColumnType<string | null, string | null | undefined, string | null>;
  decided_by: ColumnType<string | null, string | null | undefined, string | null>;
  decided_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: Ts;
  updated_at: Ts;
}

export interface RequestEventsTable {
  id: Generated<number>;
  request_id: string;
  at: Ts;
  actor_id: string | null;
  actor: string;
  kind: "requested" | "comment" | "approved" | "rejected" | "withdrawn" | "replanned" | "applied" | "apply_failed";
  body: ColumnType<string | null, string | null | undefined, string | null>;
  data: ColumnType<Record<string, unknown>, string | undefined, string>;
}

export interface StateRescuesTable {
  id: Generated<string>;
  project_id: string;
  run_id: string | null;
  serial: number;
  lineage: string;
  key_id: string;
  nonce: Buffer;
  data: Buffer;
  created_at: Ts;
  resolved_at: TsNull;
  resolved_by: ColumnType<string | null, string | null | undefined, string | null>;
  resolution: ColumnType<"restored" | "dismissed" | null, "restored" | "dismissed" | null | undefined, "restored" | "dismissed" | null>;
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
  api_tokens: ApiTokensTable;
  runs: RunsTable;
  run_logs: RunLogsTable;
  state_versions: StateVersionsTable;
  state_locks: StateLocksTable;
  project_variables: ProjectVariablesTable;
  aws_connections: AwsConnectionsTable;
  requests: RequestsTable;
  request_events: RequestEventsTable;
  state_rescues: StateRescuesTable;
}

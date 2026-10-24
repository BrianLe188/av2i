-- Accounts, sessions, authorization and the audit log (DD-021, A1).
create extension if not exists citext;

create table users (
  id uuid primary key default gen_random_uuid(),
  username citext not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  display_name text not null default '',
  password_hash text not null,
  must_change_password boolean not null default true,
  disabled boolean not null default false,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  password_changed_at timestamptz,
  last_login_at timestamptz,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip inet,
  user_agent text
);
create index sessions_user_idx on sessions (user_id);

create table login_throttle (
  key text primary key,
  attempts integer not null default 0,
  window_start timestamptz not null default now(),
  blocked_until timestamptz
);

create table groups (
  id uuid primary key default gen_random_uuid(),
  name citext not null unique check (name ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  description text not null default '',
  created_at timestamptz not null default now()
);

create table group_members (
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on group_members (user_id);

create table policies (
  id uuid primary key default gen_random_uuid(),
  name citext not null unique check (name ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  description text not null default '',
  document jsonb not null,
  builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table policy_attachments (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies (id) on delete cascade,
  user_id uuid references users (id) on delete cascade,
  group_id uuid references groups (id) on delete cascade,
  constraint policy_attachments_one_principal check ((user_id is null) <> (group_id is null))
);
create unique index policy_attachments_user_uq on policy_attachments (policy_id, user_id) where user_id is not null;
create unique index policy_attachments_group_uq on policy_attachments (policy_id, group_id) where group_id is not null;
create index policy_attachments_user_idx on policy_attachments (user_id);
create index policy_attachments_group_idx on policy_attachments (group_id);

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid references users (id) on delete set null,
  actor_username text,
  action text not null,
  resource text,
  outcome text not null check (outcome in ('success', 'denied', 'failure')),
  ip inet,
  details jsonb not null default '{}'::jsonb
);
create index audit_log_at_idx on audit_log (at desc);

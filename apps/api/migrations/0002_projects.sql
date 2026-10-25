-- Projects, their snapshots and who they are shared with (DD-021, A2).
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references users (id) on delete restrict,
  design jsonb not null,
  rev integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id) on delete set null,
  deleted_at timestamptz
);
create index projects_owner_idx on projects (owner_id) where deleted_at is null;
create index projects_updated_idx on projects (updated_at desc) where deleted_at is null;

create table project_versions (
  project_id uuid not null references projects (id) on delete cascade,
  version integer not null,
  design jsonb not null,
  note text not null default '',
  auto boolean not null default false,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, version)
);

create table project_shares (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid references users (id) on delete cascade,
  group_id uuid references groups (id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  granted_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint project_shares_one_principal check ((user_id is null) <> (group_id is null))
);
create unique index project_shares_user_uq on project_shares (project_id, user_id) where user_id is not null;
create unique index project_shares_group_uq on project_shares (project_id, group_id) where group_id is not null;
create index project_shares_user_idx on project_shares (user_id);
create index project_shares_group_idx on project_shares (group_id);

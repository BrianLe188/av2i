-- Permissions given straight to a user or a group, without a policy to name and keep (DD-030). Evaluated like an attached policy.
create table direct_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id) on delete cascade,
  group_id uuid references groups (id) on delete cascade,
  document jsonb not null,
  updated_by uuid references users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint direct_permissions_one_owner check ((user_id is null) <> (group_id is null))
);
create unique index direct_permissions_user_uq on direct_permissions (user_id) where user_id is not null;
create unique index direct_permissions_group_uq on direct_permissions (group_id) where group_id is not null;

-- Apply with approval and the state rescue (DD-026, R2b).
alter table runs add column plan_run_id uuid references runs (id) on delete set null;
alter table runs add column files_hash text;

-- a plan is applied once: no second apply of it while one is queued, running or done
create unique index runs_one_apply_per_plan on runs (plan_run_id)
  where kind = 'apply' and status in ('queued', 'running', 'succeeded');

-- an apply cut off by a restart: the infrastructure may have changed without the state following
alter table runs drop constraint runs_status_check;
alter table runs add constraint runs_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'));

create table run_approvals (
  run_id uuid not null references runs (id) on delete cascade,
  user_id uuid references users (id) on delete set null,
  username text not null,
  at timestamptz not null default now(),
  primary key (run_id, username)
);

alter table projects add column require_approval boolean not null default false;
alter table state_locks add column run_id uuid references runs (id) on delete set null;

-- what an apply created but could not write to the state (OpenTofu's errored.tfstate), sealed like state
create table state_rescues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  run_id uuid references runs (id) on delete set null,
  serial integer not null,
  lineage text not null,
  key_id text not null,
  nonce bytea not null,
  data bytea not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references users (id) on delete set null,
  resolution text check (resolution in ('restored', 'dismissed'))
);
create index state_rescues_open_idx on state_rescues (project_id) where resolved_at is null;

-- Runs of OpenTofu and the state they leave behind (DD-023, R1). A run is a job in a queue; state is a row per version, encrypted.
create table runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  kind text not null check (kind in ('plan', 'apply')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  -- the design the run works on, copied when it was queued, and a hash of it to tell a plan is out of date
  design jsonb not null,
  design_hash text not null,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  -- what a plan will do: counts and the resources touched
  summary jsonb,
  -- the plan file, encrypted like state; applying runs exactly this
  plan_data bytea,
  plan_nonce bytea,
  plan_key_id text,
  -- state serial at plan time; an apply is refused when state moved on
  state_serial integer,
  -- the secret the tofu process presents to the state backend, only while the run is running
  state_token_hash bytea
);
create index runs_queue_idx on runs (created_at) where status = 'queued';
create index runs_project_idx on runs (project_id, created_at desc);

create table run_logs (
  run_id uuid not null references runs (id) on delete cascade,
  seq integer not null,
  at timestamptz not null default now(),
  line text not null,
  primary key (run_id, seq)
);

create table state_versions (
  id bigint generated always as identity primary key,
  project_id uuid not null references projects (id) on delete cascade,
  serial integer not null,
  lineage text not null,
  key_id text not null,
  nonce bytea not null,
  data bytea not null,
  run_id uuid references runs (id) on delete set null,
  created_at timestamptz not null default now()
);
create index state_versions_project_idx on state_versions (project_id, id desc);

create table state_locks (
  project_id uuid primary key references projects (id) on delete cascade,
  lock_id text not null,
  info jsonb not null,
  created_at timestamptz not null default now()
);

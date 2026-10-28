-- Requests: asking for an apply to be approved (DD-027). Replaces the "two people" setting and its approvals, which never shipped.
alter table projects drop column require_approval;
alter table projects add column request_seq integer not null default 0;
drop table run_approvals;

create table requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  -- #1, #2 ... inside the project
  number integer not null,
  -- the extension point: a later kind adds a value here and its screens
  kind text not null check (kind in ('apply')),
  -- the plan under review; a newer plan can take its place
  plan_run_id uuid references runs (id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'applied', 'closed')),
  close_reason text check (close_reason in ('rejected', 'withdrawn')),
  -- names are kept as text so the history survives the removal of an account
  requester_id uuid references users (id) on delete set null,
  requester text not null,
  decided_by_id uuid references users (id) on delete set null,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, number)
);
create unique index requests_one_live_per_plan on requests (plan_run_id) where status in ('waiting', 'approved');
create index requests_project_idx on requests (project_id, number desc);
create index requests_waiting_idx on requests (status) where status = 'waiting';

-- the timeline and the talk of a request
create table request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references requests (id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid references users (id) on delete set null,
  actor text not null,
  kind text not null check (kind in ('requested', 'comment', 'approved', 'rejected', 'withdrawn', 'replanned', 'applied', 'apply_failed')),
  body text,
  data jsonb not null default '{}'
);
create index request_events_idx on request_events (request_id, id);

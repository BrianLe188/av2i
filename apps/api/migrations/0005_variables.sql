-- Values for the inputs a design needs (a database password), set per project and kept encrypted like state (DD-024).
create table project_variables (
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  key_id text not null,
  nonce bytea not null,
  data bytea not null,
  updated_by uuid references users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (project_id, name)
);

-- a stamp of the variables a run was queued with: a plan keeps the values it was made with, so an apply must notice they changed
alter table runs add column variables_hash text;

-- AWS connections: the roles a project's runs assume in a customer account (DD-025). Only ARNs and an ExternalId, never a key.
create table aws_connections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  plan_role_arn text not null,
  -- null: the connection is for plans only
  apply_role_arn text,
  external_id text not null,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_test_at timestamptz,
  -- { plan: {ok, arn?, account?, error?}, apply: {...} }
  last_test jsonb
);
create unique index aws_connections_name_idx on aws_connections (lower(name));

alter table projects add column connection_id uuid references aws_connections (id) on delete restrict;

-- what a run ran as, kept after the project is changed
alter table runs add column connection_id uuid references aws_connections (id) on delete set null;
alter table runs add column role_arn text;
alter table runs add column aws_account text;

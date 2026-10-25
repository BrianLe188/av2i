-- Personal API tokens for scripts and CI (DD-021, A4). Only a hash is stored; the secret is shown once at creation.
create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null,
  token_hash bytea not null unique,
  -- the first characters of the secret, so a person can tell tokens apart without the secret
  prefix text not null,
  -- null: everything the person may do; otherwise the only actions the token may use
  actions text[],
  expires_at timestamptz,
  last_used_at timestamptz,
  last_used_ip text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index api_tokens_user_idx on api_tokens (user_id);

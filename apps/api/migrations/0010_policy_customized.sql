-- A built-in policy can be changed (DD-029): `customized` tells the start-up sync to leave it alone, and `seen_actions` is the list of
-- permissions that existed when it was last saved, so that a permission added by a later version can be pointed out.
alter table policies add column customized boolean not null default false;
alter table policies add column seen_actions text[] not null default '{}';

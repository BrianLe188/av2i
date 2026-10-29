-- A run can move the state of a project between the platform and S3 (DD-032): the backend it moves to
alter table runs drop constraint runs_kind_check;
alter table runs add constraint runs_kind_check check (kind in ('plan', 'apply', 'migrate'));
alter table runs add column migrate_to jsonb;

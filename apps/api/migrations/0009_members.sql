-- Members of a project carry the permissions they hold there (DD-028): `actions` is what is evaluated, `role` is the label.
alter table project_shares add column actions text[] not null default '{}';
update project_shares set actions = case role when 'editor' then array['project:Read', 'project:Write'] else array['project:Read'] end;
alter table project_shares drop constraint project_shares_role_check;
alter table project_shares add constraint project_shares_role_check check (role in ('viewer', 'editor', 'runner', 'approver', 'maintainer', 'custom'));

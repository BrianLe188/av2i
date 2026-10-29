-- What a stored state holds, for the state viewer (DD-032): written with each version; older rows are filled in the first time they are read.
alter table state_versions add column resources integer;
alter table state_versions add column outputs integer;
alter table state_versions add column bytes integer;

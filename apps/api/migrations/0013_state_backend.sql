-- Where a project's state lives (DD-032): null is the platform; otherwise { kind: "s3", bucket, key, region, ... }
alter table projects add column state_backend jsonb;

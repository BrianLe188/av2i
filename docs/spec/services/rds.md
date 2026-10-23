---
id: rds
title: { vi: "RDS (cơ sở dữ liệu quan hệ)", en: "Amazon RDS DB instance" }
terraform:
  resources: [aws_db_instance, aws_db_subnet_group]
scope: az
placement:
  requires: [vpc, db-subnet-group]
  subnet_type: private
  min_azs: 2                   # the subnet group needs two AZs even for a single-AZ instance
sources:
  S1: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/db_instance.html.markdown
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/db_subnet_group.html.markdown
  S3: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html
  S4: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html
  S5: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html
  S6: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html
  S7: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html
scope_note: "A single aws_db_instance running PostgreSQL or MySQL, optionally Multi-AZ instance deployment. Aurora, Multi-AZ DB clusters, read replicas, RDS Proxy, Custom, Oracle, SQL Server, Db2, MariaDB, blue/green, parameter and option groups, Active Directory, S3 import, snapshots and restores, IPv6 and dual-stack are out of scope (decision D-015)"
properties:
  - key: identifier
    type: string
    required: true            # provider generates one if omitted; the platform names instances
    constraints: ["1 to 63 alphanumeric characters or hyphens", "first character a letter", "no trailing hyphen, no two consecutive hyphens", "unique per account and Region"]
    src: [S1, S4]
    status: verified
  - key: engine
    type: enum
    values: [postgres, mysql]
    required: true
    src: [S1]
    status: verified          # values are the platform's scope; the provider accepts others
  - key: engine_version
    type: string
    constraints: ["a prefix such as 8.0 is accepted when auto_minor_version_upgrade is on; the resolved value is engine_version_actual"]
    src: [S1]
    status: verified
  - key: instance_class
    type: string
    required: true
    constraints: ["in a VPC with dedicated tenancy it must be an approved dedicated instance class"]
    src: [S1, S3]
    status: verified
  - key: allocated_storage
    type: number
    required: true
    unit: GiB
    constraints: ["ranges per engine and storage type are not read here (unverified)", "ignored for replicas"]
    src: [S1]
    status: verified          # requirement verified; ranges unverified
  - key: max_allocated_storage
    type: number
    default: "autoscaling off"
    constraints: ["must be >= allocated_storage", "0 disables autoscaling explicitly"]
    src: [S1]
    status: verified
  - key: storage_type
    type: enum
    values: [standard, gp2, gp3, io1, io2]
    default: "gp2 (io1 if iops is set)"
    src: [S1]
    status: verified
  - key: storage_encrypted
    type: boolean
    default: false
    constraints: ["only at creation: an existing unencrypted instance cannot be encrypted in place and encryption cannot be removed", "the KMS key cannot be changed once set"]
    src: [S1, S6]
    status: verified
  - key: kms_key_id
    type: string
    src: [S1, S6]
    status: verified
  - key: db_name
    type: string
    constraints: ["optional; no database is created when omitted", "constraints differ by engine (unverified)"]
    src: [S1, S4]
    status: verified
  - key: username
    type: string
    required: true
    constraints: ["constraints differ by engine (unverified)"]
    src: [S1, S4]
    status: verified
  - key: manage_master_user_password
    type: boolean
    default: false
    constraints:
      - "RDS generates the password and keeps it in Secrets Manager; rotated every 7 days by default"
      - "conflicts with password and password_wo"
      - "the secret's KMS key cannot be changed afterwards"
      - "not supported with read replicas of such a source (except SQL Server and Db2), blue/green deployments, RDS Custom or Oracle Data Guard switchover"
      - "the secret is deleted with the instance"
    src: [S1, S7]
    status: verified
  - key: password
    type: string
    sensitive: true
    constraints:
      - "required unless manage_master_user_password, snapshot_identifier or replicate_source_db"
      - "printable ASCII except / ' \" @ and space; MySQL 8 to 41 characters, PostgreSQL 8 to 128"
      - "stored in Terraform state in plain text; password_wo (Terraform 1.11 or later, with password_wo_version) avoids that; the v6.66.0 page also says password_wo 'will be stored in the state file', which contradicts it and was removed on main, so treat the write-only behaviour as unverified"
    src: [S1, S4]
    status: verified
  - key: db_subnet_group_name
    type: reference
    ref: db-subnet-group
    required: true            # platform rule; the provider falls back to a group named default
    src: [S1, S3]
    status: verified
  - key: vpc_security_group_ids
    type: list
    ref: security-group
    required: true            # platform rule D-005
    src: [S1]
    status: verified
  - key: publicly_accessible
    type: boolean
    default: false
    constraints: ["needs every subnet of the DB subnet group to be public (internet-gateway route) and VPC DNS support and DNS hostnames on", "access is still controlled by the security group"]
    src: [S1, S3]
    status: verified
  - key: multi_az
    type: boolean
    constraints: ["Multi-AZ instance deployment: one synchronous standby in another AZ that serves no read traffic", "needs subnets in at least two AZs in the subnet group", "the provider page gives no further behaviour"]
    src: [S1, S3, S5]
    status: verified
  - key: availability_zone
    type: string
    src: [S1]
    status: verified
  - key: port
    type: number
    default: "engine default (5432 PostgreSQL, 3306 MySQL)"
    src: [S1]
    status: verified          # the provider gives no default; the engine ports are general knowledge (unverified)
  - key: backup_retention_period
    type: number
    default: 0
    range: [0, 35]
    constraints: ["must be > 0 for read replica sources and blue/green"]
    src: [S1]
    status: verified
  - key: backup_window
    type: string
    constraints: ["UTC, for example 09:46-10:16", "must not overlap maintenance_window"]
    src: [S1]
    status: verified
  - key: maintenance_window
    type: string
    constraints: ["ddd:hh24:mi-ddd:hh24:mi"]
    src: [S1]
    status: verified
  - key: deletion_protection
    type: boolean
    default: false
    src: [S1]
    status: verified
  - key: skip_final_snapshot
    type: boolean
    default: false
    constraints: ["when false, final_snapshot_identifier is required: starts with a letter, alphanumerics and hyphens, no trailing hyphen, no consecutive hyphens"]
    src: [S1]
    status: verified
  - key: auto_minor_version_upgrade
    type: boolean
    default: true
    src: [S1]
    status: verified
  - key: apply_immediately
    type: boolean
    default: false
    constraints: ["true applies changes now and can cause a brief outage from a reboot; otherwise changes wait for the maintenance window and Terraform can show a diff meanwhile"]
    src: [S1]
    status: verified
  - key: iam_database_authentication_enabled
    type: boolean
    src: [S1]
    status: verified
  - key: performance_insights_enabled
    type: boolean
    default: false
    src: [S1]
    status: verified
  - key: monitoring_interval
    type: number
    default: 0
    values: [0, 1, 5, 10, 15, 30, 60]
    constraints: ["Enhanced Monitoring needs monitoring_role_arn (an IAM role)"]
    src: [S1]
    status: verified
  - key: copy_tags_to_snapshot
    type: boolean
    default: false
    src: [S1]
    status: verified
  - key: tags
    type: map
    src: [S1]
    status: verified
subnet_group:
  - { key: name, type: string, force_new: true, constraints: ["1 to 255 characters: alphanumerics, spaces, hyphens, underscores, periods"], src: [S2, S4], status: verified }
  - { key: description, type: string, default: "Managed by Terraform", src: [S2], status: verified }
  - { key: subnet_ids, type: list, ref: subnet, required: true, constraints: ["at least two subnets in two different AZs", "at most 20", "all in one VPC (the group's vpc_id is exported)"], src: [S2, S3, S4], status: verified }
limits:
  - { id: db_instances_per_region, value: 40, adjustable: true, src: [S4], status: verified, note: "20 in ap-south-1; shared with Aurora, Neptune and DocumentDB instances" }
  - { id: db_subnet_groups, value: 50, adjustable: true, src: [S4], status: verified, note: "20 in ap-south-1" }
  - { id: subnets_per_db_subnet_group, value: 20, adjustable: false, src: [S4], status: verified }
  - { id: read_replicas_per_primary, value: 15, adjustable: true, src: [S4], status: verified }
  - { id: manual_snapshots, value: 100, adjustable: true, src: [S4], status: verified }
  - { id: total_storage_gb, value: 100000, adjustable: true, src: [S4], status: verified }
  - { id: iam_roles_per_db_instance, value: 5, adjustable: true, src: [S4], status: verified }
  - { id: max_connections, value: "engine and instance class dependent; MySQL about memory/12 MB, PostgreSQL about memory/9.5 MB, capped", adjustable: true, src: [S4], status: verified, note: "set in the parameter group" }
relations: [db-subnet-group, sg-attach, network-access, containment, grant, assume-role]
cost: { model: hourly, notes: "instance hours, storage, backup storage beyond the free allowance, Multi-AZ doubles the instance cost, Secrets Manager charges apply when managing the password (S7). Prices unverified" }
status: verified
---

# RDS DB instance

## Purpose

A managed relational database (PostgreSQL or MySQL here). AWS runs the engine, patching, backups and failover.
Use it when the application needs SQL and transactions. Not for object storage ([s3](s3.md)) or key-value access
patterns that fit a NoSQL service (Tier 2).

## Behaviour

- **A DB subnet group is required.** A VPC must have one, made of at least two subnets in two different AZs, even
  for a single-AZ instance, so that the instance can later become Multi-AZ and so RDS can place a new standby
  (S3). RDS picks a subnet and an address from the group and uses that subnet's AZ (S3). The group is typically
  private subnets (S3). See [db-subnet-group](../relations/db-subnet-group.md).
- **Address changes on failover.** The private IP changes during failover, so clients must connect by the DNS
  endpoint, not by IP (S3).
- **Spare addresses.** Each subnet in the group needs at least one free address per instance for recovery and
  scaling operations, so subnets must be large enough (S3).
- **Security group.** A VPC security group that allows the client must be attached (S3). With no group given AWS
  uses the VPC default group (S3); this platform requires an explicit one (D-005).
- **Publicly accessible.** Gives the instance a public address in addition to the private one. The DNS name
  resolves to the private address inside the VPC and the public one outside. It needs every subnet of the group to
  be public and the VPC attributes DNS support and DNS hostnames on; the security group must still allow the
  traffic (S3). Changing a subnet from public to private later can break a publicly accessible instance (S3).
- **Dedicated-tenancy VPC.** The instance class must be an approved dedicated instance class (S3).
- **Multi-AZ.** A Multi-AZ DB instance deployment has one standby in another AZ that provides failover and serves
  no reads; a Multi-AZ DB cluster with two standbys is a different thing and out of scope (S5).
- **Storage encryption** can be chosen only at creation. An unencrypted instance cannot be encrypted in place, an
  encrypted one cannot be decrypted, the KMS key cannot change, and read replicas must match (S6). Disabling the
  KMS key later makes the instance inaccessible (S6).
- **Master password.** Either supplied (stored in Terraform state in plain text) or managed by RDS in Secrets
  Manager, rotated every 7 days by default (S1, S7). With the managed form the secret ARN is exported as
  `master_user_secret`. The two forms conflict (S1).
- **Backups.** `backup_retention_period` defaults to 0 in the provider, which turns automated backups off (S1);
  the AWS console's default is different, so the platform sets the value explicitly. A final snapshot is taken on
  delete unless `skip_final_snapshot` is true (S1).
- **Changes** to storage and other settings may wait for the maintenance window; `apply_immediately` applies them
  now and may reboot (S1).
- **Timeouts.** Create 40 minutes, update 80 minutes, delete 60 minutes by default (S1).

## Placement

A DB subnet group of private subnets in two or more AZs of one VPC. The instance itself sits in one of them.

## Relations

- [db-subnet-group](../relations/db-subnet-group.md): the subnets it may use.
- [sg-attach](../relations/sg-attach.md): `vpc_security_group_ids`; at least one explicit group.
- [network-access](../relations/network-access.md): callers (EC2, ECS, Lambda) reach it on the engine port.
- containment: VPC through the subnet group.
- [assume-role](../relations/assume-role.md): the Enhanced Monitoring role (`monitoring_role_arn`).
- [grant](../relations/grant.md): IAM database authentication (`rds-db:connect`), an `unverified` registry row.

## Failure modes

| Situation | Result |
|---|---|
| Subnet group with fewer than two subnets or two AZs | Rejected. Rule [VAL-058](../rules/validation.md) |
| Publicly accessible with private subnets in the group | Unreachable from the internet. Rule [VAL-062](../rules/validation.md) |
| Publicly accessible and VPC DNS attributes off | Public DNS resolution does not work (S3). Rule [VAL-062](../rules/validation.md) |
| `password` together with `manage_master_user_password` | Conflict; rejected (S1). Rule [VAL-069](../rules/validation.md) |
| Identifier not matching the rules | Rejected (S4). Rule [VAL-059](../rules/validation.md) |
| `backup_window` overlapping `maintenance_window` | Rejected (S1). Rule [VAL-063](../rules/validation.md) |
| `skip_final_snapshot` false and no final snapshot identifier | Rejected (S1). Rule [VAL-064](../rules/validation.md) |
| `max_allocated_storage` below `allocated_storage` | Rejected (S1). Rule [VAL-065](../rules/validation.md) |
| Changing `storage_encrypted` or `kms_key_id` on an existing instance | Not possible in place; replace through an encrypted snapshot copy or a blue/green deployment (S6). Pitfall P-040 |
| Deleting with `deletion_protection` on | Blocked (S1) |
| Credentials managed by Secrets Manager and a read replica or blue/green deployment wanted | Not supported (S7) |
| Client uses the instance IP | Breaks on failover (S3) |
| Terraform diff right after changing storage | Change waits for the maintenance window unless `apply_immediately` (S1). Pitfall P-041 |

## Limits, cost, security

See front matter. Security: encrypt at creation ([SEC-018](../rules/security.md)), keep it private
([SEC-017](../rules/security.md)), prefer the managed password ([SEC-020](../rules/security.md)), keep backups on
([SEC-021](../rules/security.md)), and never open the database port to the internet
([SEC-023](../rules/security.md)).

## Terraform mapping

`aws_db_subnet_group` (`name`, `subnet_ids`) and `aws_db_instance` (`identifier`, `engine`, `engine_version`,
`instance_class`, `allocated_storage`, `storage_type`, `storage_encrypted`, `db_name`, `username`,
`manage_master_user_password` or `password`, `db_subnet_group_name`, `vpc_security_group_ids`,
`publicly_accessible`, `multi_az`, `backup_retention_period`, `deletion_protection`, `skip_final_snapshot`,
`final_snapshot_identifier`, `tags`). Read the resolved engine version from `engine_version_actual` (S1). For the
managed password, reference `master_user_secret[0].secret_arn` when ordering other resources after the instance
(S1). Pitfalls P-039 to P-042 apply.

## Sources

S1 to S7 in the front matter.

---
id: container-backend
title: { vi: "Backend container: ECS Fargate, ECR, RDS, S3 và Lambda trong VPC", en: "Container backend: ECS Fargate, ECR, RDS, S3 and Lambda in a VPC" }
services: [vpc, subnet, internet-gateway, nat-gateway, elastic-ip, route-table, security-group, ecs, ecr, rds, db-subnet-group, s3, lambda, iam-role, ec2]
executable: true
design:
  schema: 1
  name: container-backend
  settings: { region: ap-southeast-1 }
  nodes:
    - { key: vpc, label: "Backend", service: vpc, props: { cidr_block: "10.2.0.0/16", enable_dns_support: true, enable_dns_hostnames: true } }
    - { key: igw, label: "Internet gateway", service: internet-gateway, parent: vpc, props: {} }
    - { key: pub_a, label: "Public A", service: subnet, parent: vpc, props: { cidr_block: "10.2.0.0/24", availability_zone: ap-southeast-1a } }
    - { key: pub_b, label: "Public B", service: subnet, parent: vpc, props: { cidr_block: "10.2.1.0/24", availability_zone: ap-southeast-1b } }
    - { key: app_a, label: "App A", service: subnet, parent: vpc, props: { cidr_block: "10.2.10.0/24", availability_zone: ap-southeast-1a } }
    - { key: app_b, label: "App B", service: subnet, parent: vpc, props: { cidr_block: "10.2.11.0/24", availability_zone: ap-southeast-1b } }
    - { key: db_a, label: "Data A", service: subnet, parent: vpc, props: { cidr_block: "10.2.20.0/24", availability_zone: ap-southeast-1a } }
    - { key: db_b, label: "Data B", service: subnet, parent: vpc, props: { cidr_block: "10.2.21.0/24", availability_zone: ap-southeast-1b } }
    - { key: nat_a, label: "NAT A", service: nat-gateway, parent: pub_a, props: { availability_mode: zonal, connectivity_type: public } }
    - { key: nat_b, label: "NAT B", service: nat-gateway, parent: pub_b, props: { availability_mode: zonal, connectivity_type: public } }
    - { key: rt_public, label: "Public routes", service: route-table, parent: vpc, props: {} }
    - { key: rt_app_a, label: "App A routes", service: route-table, parent: vpc, props: {} }
    - { key: rt_app_b, label: "App B routes", service: route-table, parent: vpc, props: {} }
    - { key: sg_task, label: "task-sg", service: security-group, parent: vpc, props: { name: task-sg, description: "ECS tasks" } }
    - { key: sg_db, label: "db-sg", service: security-group, parent: vpc, props: { name: db-sg, description: "Database" } }
    - { key: sg_fn, label: "fn-sg", service: security-group, parent: vpc, props: { name: fn-sg, description: "Worker function" } }
    - { key: repo, label: "Backend images", service: ecr, props: { name: backend, image_tag_mutability: IMMUTABLE, image_scanning_configuration: { scan_on_push: true } } }
    - { key: cluster, label: "Backend cluster", service: ecs, props: { part: cluster, name: backend } }
    - { key: web, label: "Web", service: ecs, parent: app_a, props: { part: service, name: web, cluster: cluster, cpu: "512", memory: "1024", desired_count: 2, container_port: 8080, image_tag: v1 } }
    - { key: db, label: "Database", service: rds, parent: vpc, props: { engine: postgres, instance_class: db.t3.micro, allocated_storage: 20, username: app, deletion_protection: true } }
    - { key: db_group, label: "Database subnets", service: db-subnet-group, parent: vpc, props: { name: backend-db } }
    - { key: files, label: "Files", service: s3, props: { bucket: av2i-example-files } }
    - { key: task_role, label: "Task role", service: iam-role, props: { name: backend-task } }
    - { key: fn, label: "Worker", service: lambda, parent: app_a, props: { function_name: worker, filename: lambda.zip, handler: index.handler, runtime: nodejs22.x, memory_size: 256, timeout: 10 } }
  edges:
    - { id: e_rt_public_igw, mechanism: route, from: rt_public, to: igw, props: { destination_cidr_block: "0.0.0.0/0" } }
    - { id: e_rt_public_pub_a, mechanism: route-association, from: rt_public, to: pub_a }
    - { id: e_rt_public_pub_b, mechanism: route-association, from: rt_public, to: pub_b }
    - { id: e_rt_app_a_nat, mechanism: route, from: rt_app_a, to: nat_a, props: { destination_cidr_block: "0.0.0.0/0" } }
    - { id: e_rt_app_b_nat, mechanism: route, from: rt_app_b, to: nat_b, props: { destination_cidr_block: "0.0.0.0/0" } }
    - { id: e_rt_app_a_app, mechanism: route-association, from: rt_app_a, to: app_a }
    - { id: e_rt_app_b_app, mechanism: route-association, from: rt_app_b, to: app_b }
    - { id: e_web_b, mechanism: containment, from: app_b, to: web }
    - { id: e_fn_b, mechanism: containment, from: app_b, to: fn }
    - { id: e_dbg_a, mechanism: containment, from: db_a, to: db_group }
    - { id: e_dbg_b, mechanism: containment, from: db_b, to: db_group }
    - { id: e_db_group, mechanism: db-subnet-group, from: db, to: db_group }
    - { id: e_sg_task, mechanism: sg-attach, from: sg_task, to: web }
    - { id: e_sg_db, mechanism: sg-attach, from: sg_db, to: db }
    - { id: e_sg_fn, mechanism: sg-attach, from: sg_fn, to: fn }
    - { id: e_repo_web, mechanism: image-source, from: repo, to: web }
    - { id: e_web_db, mechanism: network-access, from: web, to: db }
    - { id: e_fn_db, mechanism: network-access, from: fn, to: db }
    - { id: e_task_role, mechanism: assume-role, from: task_role, to: web, props: { slot: task } }
    - { id: e_task_files, mechanism: grant, from: task_role, to: files, props: { level: readwrite } }
expect:
  errors: []
  findings: [SEC-008]
patch_ops:
  - "see ec2-in-vpc for the six patch operations (DD-012)"
variants:
  - { id: cpu-memory-mismatch, change: "cpu 256 with memory 4096", patch: [{"op": "set", "node": "web", "path": "props.cpu", "value": "256"}, {"op": "set", "node": "web", "path": "props.memory", "value": "4096"}], fires: [VAL-040], severity: error }
  - { id: too-many-groups, change: "six security groups on the service", patch: [{"op": "add-node", "node": {"key": "sg_x1", "label": "x1", "service": "security-group", "parent": "vpc", "props": {"name": "x-sg-1", "description": "extra"}}}, {"op": "add-edge", "edge": {"id": "e_x1", "mechanism": "sg-attach", "from": "sg_x1", "to": "web"}}, {"op": "add-node", "node": {"key": "sg_x2", "label": "x2", "service": "security-group", "parent": "vpc", "props": {"name": "x-sg-2", "description": "extra"}}}, {"op": "add-edge", "edge": {"id": "e_x2", "mechanism": "sg-attach", "from": "sg_x2", "to": "web"}}, {"op": "add-node", "node": {"key": "sg_x3", "label": "x3", "service": "security-group", "parent": "vpc", "props": {"name": "x-sg-3", "description": "extra"}}}, {"op": "add-edge", "edge": {"id": "e_x3", "mechanism": "sg-attach", "from": "sg_x3", "to": "web"}}, {"op": "add-node", "node": {"key": "sg_x4", "label": "x4", "service": "security-group", "parent": "vpc", "props": {"name": "x-sg-4", "description": "extra"}}}, {"op": "add-edge", "edge": {"id": "e_x4", "mechanism": "sg-attach", "from": "sg_x4", "to": "web"}}, {"op": "add-node", "node": {"key": "sg_x5", "label": "x5", "service": "security-group", "parent": "vpc", "props": {"name": "x-sg-5", "description": "extra"}}}, {"op": "add-edge", "edge": {"id": "e_x5", "mechanism": "sg-attach", "from": "sg_x5", "to": "web"}}], fires: [VAL-021, VAL-041], severity: error }
  - { id: no-pull-path, change: "private subnets with no NAT route", patch: [{"op": "remove-edge", "mechanism": "route", "from": "rt_app_a", "to": "nat_a"}, {"op": "remove-edge", "mechanism": "route", "from": "rt_app_b", "to": "nat_b"}], fires: [VAL-042, VAL-070], severity: warning }
  - { id: public-ip-private-subnet, change: "assign_public_ip true in private subnets", patch: [{"op": "set", "node": "web", "path": "props.assign_public_ip", "value": true}], fires: [VAL-045, SEC-011], severity: warning }
  - { id: launch-type-and-strategy, change: "both launch_type and capacity_provider_strategy", patch: [{"op": "set", "node": "web", "path": "props.launch_type", "value": "FARGATE"}, {"op": "set", "node": "web", "path": "props.capacity_provider_strategy", "value": [{"capacity_provider": "FARGATE", "weight": 1}]}], fires: [VAL-046], severity: error }
  - { id: unknown-cluster, change: "the service names a cluster that does not exist", patch: [{"op": "set", "node": "web", "path": "props.cluster", "value": "nowhere"}], fires: [VAL-048], severity: error }
  - { id: one-az, change: "tasks in app_a only", patch: [{"op": "remove-edge", "mechanism": "containment", "from": "app_b", "to": "web"}], fires: [VAL-037], severity: warning }
  - { id: exec-without-ssm, change: "enable_execute_command true and the task role lacks the ssmmessages actions", patch: [{"op": "set", "node": "web", "path": "props.enable_execute_command", "value": true}], fires: [VAL-113], severity: error }
  - { id: exec-without-task-role, change: "enable_execute_command true and no task role", patch: [{"op": "set", "node": "web", "path": "props.enable_execute_command", "value": true}, {"op": "remove-edge", "mechanism": "assume-role", "from": "task_role", "to": "web"}], fires: [VAL-106, VAL-112], severity: error }
  - { id: exec-with-ssm, change: "enable_execute_command true and the task role allows the ssmmessages actions", patch: [{"op": "set", "node": "web", "path": "props.enable_execute_command", "value": true}, {"op": "set", "node": "task_role", "path": "props.raw_policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"], "Resource": "*"}]}}], fires: [], severity: info }
  - { id: execution-role-missing-policy, change: "a drawn execution role without AmazonECSTaskExecutionRolePolicy", patch: [{"op": "add-node", "node": {"key": "role_exec", "label": "Exec", "service": "iam-role", "props": {"name": "backend-exec"}}}, {"op": "add-edge", "edge": {"id": "e_exec", "mechanism": "assume-role", "from": "role_exec", "to": "web", "props": {"slot": "execution"}}}], fires: [VAL-116], severity: error }
  - { id: execution-role-with-policy, change: "a drawn execution role with the managed policy", patch: [{"op": "add-node", "node": {"key": "role_exec", "label": "Exec", "service": "iam-role", "props": {"name": "backend-exec", "managed_policies": ["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"]}}}, {"op": "add-edge", "edge": {"id": "e_exec", "mechanism": "assume-role", "from": "role_exec", "to": "web", "props": {"slot": "execution"}}}], fires: [], severity: info }
  - { id: environment, change: "environment variables on the container", patch: [{"op": "set", "node": "web", "path": "props.environment", "value": {"LOG_LEVEL": "info", "PORT": "8080"}}], fires: [], severity: info }
  - { id: capacity-provider, change: "a capacity provider strategy instead of the launch type", patch: [{"op": "set", "node": "web", "path": "props.capacity_provider_strategy", "value": [{"capacity_provider": "FARGATE", "weight": 1}]}], fires: [], severity: info }
  - { id: container-insights, change: "Container Insights on the cluster", patch: [{"op": "set", "node": "cluster", "path": "props.container_insights", "value": "enabled"}], fires: [], severity: info }
  - { id: lambda-two-sources, change: "a zip file and an S3 package", patch: [{"op": "set", "node": "fn", "path": "props.s3_bucket", "value": "code-bucket"}, {"op": "set", "node": "fn", "path": "props.s3_key", "value": "worker.zip"}], fires: [VAL-033], severity: error }
  - { id: lambda-memory-low, change: "memory_size 64", patch: [{"op": "set", "node": "fn", "path": "props.memory_size", "value": 64}], fires: [VAL-034], severity: error }
  - { id: lambda-no-group, change: "the function has subnets and no security group", patch: [{"op": "remove-edge", "mechanism": "sg-attach", "from": "sg_fn", "to": "fn"}], fires: [SEC-004, VAL-029, VAL-036], severity: error }
  - { id: lambda-public-subnet, change: "the function is attached to a public subnet", patch: [{"op": "add-edge", "edge": {"id": "e_fn_pub", "mechanism": "containment", "from": "pub_a", "to": "fn"}}], fires: [VAL-038], severity: warning }
  - { id: lambda-dedicated-vpc, change: "the VPC has dedicated tenancy", patch: [{"op": "set", "node": "vpc", "path": "props.instance_tenancy", "value": "dedicated"}], fires: [VAL-039], severity: error }
  - { id: lambda-two-roles, change: "two drawn execution roles", patch: [{"op": "add-node", "node": {"key": "role_a", "label": "A", "service": "iam-role", "props": {"name": "worker-a", "managed_policies": ["arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"]}}}, {"op": "add-node", "node": {"key": "role_b", "label": "B", "service": "iam-role", "props": {"name": "worker-b", "managed_policies": ["arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"]}}}, {"op": "add-edge", "edge": {"id": "e_a", "mechanism": "assume-role", "from": "role_a", "to": "fn", "props": {"slot": "execution"}}}, {"op": "add-edge", "edge": {"id": "e_b", "mechanism": "assume-role", "from": "role_b", "to": "fn", "props": {"slot": "execution"}}}], fires: [VAL-110], severity: error }
  - { id: lambda-role-without-vpc-policy, change: "a drawn execution role without the VPC permissions", patch: [{"op": "add-node", "node": {"key": "role_fn", "label": "Worker role", "service": "iam-role", "props": {"name": "worker-role"}}}, {"op": "add-edge", "edge": {"id": "e_role_fn", "mechanism": "assume-role", "from": "role_fn", "to": "fn", "props": {"slot": "execution"}}}], clears: [SEC-008], fires: [VAL-111], severity: error }
  - { id: lambda-outside-vpc, change: "the function calls the database but is not attached to the VPC", patch: [{"op": "set", "node": "fn", "path": "parent", "value": null}, {"op": "remove-edge", "mechanism": "containment", "from": "app_b", "to": "fn"}, {"op": "remove-edge", "mechanism": "sg-attach", "from": "sg_fn", "to": "fn"}], clears: [SEC-008], fires: [VAL-049], severity: error }
  - { id: lambda-image, change: "the function runs an image from the repository", patch: [{"op": "unset", "node": "fn", "path": "props.filename"}, {"op": "unset", "node": "fn", "path": "props.handler"}, {"op": "unset", "node": "fn", "path": "props.runtime"}, {"op": "add-edge", "edge": {"id": "e_repo_fn", "mechanism": "image-source", "from": "repo", "to": "fn"}}], fires: [SEC-010], severity: info }
  - { id: lambda-image-tag, change: "the function runs the image tagged v1", patch: [{"op": "unset", "node": "fn", "path": "props.filename"}, {"op": "unset", "node": "fn", "path": "props.handler"}, {"op": "unset", "node": "fn", "path": "props.runtime"}, {"op": "set", "node": "fn", "path": "props.image_tag", "value": "v1"}, {"op": "add-edge", "edge": {"id": "e_repo_fn", "mechanism": "image-source", "from": "repo", "to": "fn"}}], fires: [], severity: info }
  - { id: db-open, change: "the database port open to the world", patch: [{"op": "set", "node": "sg_db", "path": "props.ingress_rules", "value": [{"ip_protocol": "tcp", "from_port": 5432, "to_port": 5432, "cidr_ipv4": "0.0.0.0/0"}]}], fires: [SEC-023], severity: error }
  - { id: db-one-subnet, change: "the database spans one subnet", patch: [{"op": "remove-edge", "mechanism": "containment", "from": "db_b", "to": "db_group"}], fires: [VAL-058], severity: error }
  - { id: db-multi-az-one-az, change: "multi_az with one Availability Zone", patch: [{"op": "remove-edge", "mechanism": "containment", "from": "db_b", "to": "db_group"}, {"op": "set", "node": "db", "path": "props.multi_az", "value": true}], fires: [VAL-058, VAL-067], severity: error }
  - { id: db-bad-identifier, change: "an identifier with two hyphens", patch: [{"op": "set", "node": "db", "path": "props.identifier", "value": "bad--id"}], fires: [VAL-059], severity: error }
  - { id: db-no-username, change: "no master user", patch: [{"op": "unset", "node": "db", "path": "props.username"}], fires: [VAL-060], severity: error }
  - { id: db-short-password, change: "a password of 5 characters", patch: [{"op": "set", "node": "db", "path": "props.password", "value": "abc12"}], fires: [SEC-020, VAL-061], severity: error }
  - { id: db-password, change: "a password supplied through a variable", patch: [{"op": "set", "node": "db", "path": "props.password", "value": "Sup3rSecretPass"}], fires: [SEC-020], severity: warning }
  - { id: db-public, change: "publicly accessible in private subnets", patch: [{"op": "set", "node": "db", "path": "props.publicly_accessible", "value": true}], fires: [SEC-017, VAL-062], severity: warning }
  - { id: db-backup-too-long, change: "35 days is the limit", patch: [{"op": "set", "node": "db", "path": "props.backup_retention_period", "value": 40}], fires: [VAL-063], severity: error }
  - { id: db-windows-overlap, change: "backup and maintenance windows overlap", patch: [{"op": "set", "node": "db", "path": "props.backup_window", "value": "03:00-04:00"}, {"op": "set", "node": "db", "path": "props.maintenance_window", "value": "mon:03:30-mon:04:30"}], fires: [VAL-063], severity: error }
  - { id: db-windows-apart, change: "backup and maintenance windows apart", patch: [{"op": "set", "node": "db", "path": "props.backup_window", "value": "03:00-04:00"}, {"op": "set", "node": "db", "path": "props.maintenance_window", "value": "mon:05:00-mon:06:00"}], fires: [], severity: info }
  - { id: db-bad-snapshot-id, change: "a final snapshot identifier ending in a hyphen", patch: [{"op": "set", "node": "db", "path": "props.final_snapshot_identifier", "value": "last-"}], fires: [VAL-064], severity: error }
  - { id: db-max-below-allocated, change: "max_allocated_storage below allocated_storage", patch: [{"op": "set", "node": "db", "path": "props.allocated_storage", "value": 100}, {"op": "set", "node": "db", "path": "props.max_allocated_storage", "value": 50}], fires: [VAL-065], severity: error }
  - { id: db-managed-and-password, change: "manage_master_user_password together with password", patch: [{"op": "set", "node": "db", "path": "props.manage_master_user_password", "value": true}, {"op": "set", "node": "db", "path": "props.password", "value": "Sup3rSecretPass"}], fires: [SEC-020, VAL-069], severity: error }
  - { id: db-unencrypted, change: "storage not encrypted", patch: [{"op": "set", "node": "db", "path": "props.storage_encrypted", "value": false}], fires: [SEC-018], severity: warning }
  - { id: db-unprotected, change: "deletion protection off", patch: [{"op": "set", "node": "db", "path": "props.deletion_protection", "value": false}], fires: [SEC-019], severity: info }
  - { id: db-no-backups, change: "no automated backups", patch: [{"op": "set", "node": "db", "path": "props.backup_retention_period", "value": 0}], fires: [SEC-021], severity: warning }
  - { id: db-skip-snapshot, change: "no final snapshot", patch: [{"op": "set", "node": "db", "path": "props.skip_final_snapshot", "value": true}], fires: [SEC-022], severity: info }
  - { id: db-port-mismatch, change: "the connection names port 3306 for a PostgreSQL instance", patch: [{"op": "remove-edge", "mechanism": "network-access", "from": "web", "to": "db"}, {"op": "add-edge", "edge": {"id": "e_web_db_3306", "mechanism": "network-access", "from": "web", "to": "db", "props": {"port": 3306}}}], fires: [VAL-068], severity: error }
  - { id: db-monitoring-no-role, change: "Enhanced Monitoring without a role", patch: [{"op": "set", "node": "db", "path": "props.monitoring_interval", "value": 60}], fires: [VAL-114], severity: error }
  - { id: db-monitoring, change: "Enhanced Monitoring with its role", patch: [{"op": "set", "node": "db", "path": "props.monitoring_interval", "value": 60}, {"op": "add-node", "node": {"key": "mon_role", "label": "Monitoring", "service": "iam-role", "props": {"name": "db-monitoring", "managed_policies": ["arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"]}}}, {"op": "add-edge", "edge": {"id": "e_mon", "mechanism": "assume-role", "from": "mon_role", "to": "db", "props": {"slot": "monitoring"}}}], fires: [], severity: info }
  - { id: bucket-bad-name, change: "a bucket name with an underscore and capitals", patch: [{"op": "set", "node": "files", "path": "props.bucket", "value": "Bad_Name"}], fires: [VAL-050], severity: error }
  - { id: bucket-lifecycle-noncurrent, change: "a noncurrent version rule without versioning", patch: [{"op": "set", "node": "files", "path": "props.versioning", "value": {"status": "Suspended"}}, {"op": "set", "node": "files", "path": "props.lifecycle_rules", "value": [{"id": "old", "status": "Enabled", "filter": {}, "noncurrent_version_expiration": {"noncurrent_days": 30}}]}], fires: [SEC-013, VAL-056], severity: error }
  - { id: bucket-lifecycle, change: "a lifecycle rule that expires objects after 90 days", patch: [{"op": "set", "node": "files", "path": "props.lifecycle_rules", "value": [{"id": "expire", "status": "Enabled", "filter": {"prefix": "tmp/"}, "expiration": {"days": 90}}]}], fires: [], severity: info }
  - { id: bucket-lifecycle-two-filters, change: "a filter with a prefix and a size", patch: [{"op": "set", "node": "files", "path": "props.lifecycle_rules", "value": [{"id": "x", "status": "Enabled", "filter": {"prefix": "a/", "object_size_greater_than": 1}, "expiration": {"days": 1}}]}], fires: [VAL-056], severity: error }
  - { id: bucket-lock-unversioned, change: "object lock with versioning suspended", patch: [{"op": "set", "node": "files", "path": "props.object_lock_enabled", "value": true}, {"op": "set", "node": "files", "path": "props.versioning", "value": {"status": "Suspended"}}], fires: [SEC-013, VAL-057], severity: error }
  - { id: bucket-public-access, change: "one Block Public Access flag off", patch: [{"op": "set", "node": "files", "path": "props.public_access_block", "value": {"block_public_acls": false}}], fires: [SEC-012], severity: warning }
  - { id: bucket-unversioned, change: "versioning suspended", patch: [{"op": "set", "node": "files", "path": "props.versioning", "value": {"status": "Suspended"}}], fires: [SEC-013], severity: info }
  - { id: bucket-acls, change: "ACLs enabled", patch: [{"op": "set", "node": "files", "path": "props.ownership_controls", "value": {"object_ownership": "ObjectWriter"}}], fires: [SEC-014], severity: info }
  - { id: bucket-kms, change: "default encryption with a KMS key", patch: [{"op": "set", "node": "files", "path": "props.encryption", "value": {"sse_algorithm": "aws:kms", "bucket_key_enabled": true}}], fires: [], severity: info }
  - { id: repo-no-scan, change: "scan on push off", patch: [{"op": "set", "node": "repo", "path": "props.image_scanning_configuration", "value": {"scan_on_push": false}}], fires: [SEC-009], severity: info }
  - { id: repo-mutable, change: "tags can be overwritten", patch: [{"op": "set", "node": "repo", "path": "props.image_tag_mutability", "value": "MUTABLE"}], fires: [SEC-010], severity: info }
  - { id: repo-latest, change: "the service runs the latest tag", patch: [{"op": "unset", "node": "web", "path": "props.image_tag"}], fires: [SEC-010], severity: info }
  - { id: repo-lifecycle, change: "expire untagged images after 14 days", patch: [{"op": "set", "node": "repo", "path": "props.lifecycle_policy", "value": {"rules": [{"rulePriority": 1, "description": "expire untagged", "selection": {"tagStatus": "untagged", "countType": "sinceImagePushed", "countUnit": "days", "countNumber": 14}, "action": {"type": "expire"}}]}}], fires: [], severity: info }
  - { id: repo-grant-push, change: "the task role may push to the repository", patch: [{"op": "add-edge", "edge": {"id": "e_task_repo", "mechanism": "grant", "from": "task_role", "to": "repo", "props": {"level": "push"}}}], fires: [], severity: info }
  - { id: role-admin, change: "AdministratorAccess on the task role", patch: [{"op": "set", "node": "task_role", "path": "props.managed_policies", "value": ["arn:aws:iam::aws:policy/AdministratorAccess"]}], fires: [SEC-035], severity: error }
  - { id: role-bad-name, change: "a role name with a space", patch: [{"op": "set", "node": "task_role", "path": "props.name", "value": "bad name"}], fires: [VAL-103], severity: error }
  - { id: role-no-consumer, change: "the task role is not assumed by anything", patch: [{"op": "remove-edge", "mechanism": "assume-role", "from": "task_role", "to": "web"}], fires: [VAL-106], severity: warning }
  - { id: role-too-many-policies, change: "21 managed policies", patch: [{"op": "set", "node": "task_role", "path": "props.managed_policies", "value": ["arn:aws:iam::aws:policy/Policy0", "arn:aws:iam::aws:policy/Policy1", "arn:aws:iam::aws:policy/Policy2", "arn:aws:iam::aws:policy/Policy3", "arn:aws:iam::aws:policy/Policy4", "arn:aws:iam::aws:policy/Policy5", "arn:aws:iam::aws:policy/Policy6", "arn:aws:iam::aws:policy/Policy7", "arn:aws:iam::aws:policy/Policy8", "arn:aws:iam::aws:policy/Policy9", "arn:aws:iam::aws:policy/Policy10", "arn:aws:iam::aws:policy/Policy11", "arn:aws:iam::aws:policy/Policy12", "arn:aws:iam::aws:policy/Policy13", "arn:aws:iam::aws:policy/Policy14", "arn:aws:iam::aws:policy/Policy15", "arn:aws:iam::aws:policy/Policy16", "arn:aws:iam::aws:policy/Policy17", "arn:aws:iam::aws:policy/Policy18", "arn:aws:iam::aws:policy/Policy19", "arn:aws:iam::aws:policy/Policy20"]}], fires: [VAL-107], severity: error }
  - { id: role-star, change: "every action on every resource", patch: [{"op": "set", "node": "task_role", "path": "props.raw_policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "*", "Resource": "*"}]}}], fires: [SEC-036, SEC-042], severity: error }
  - { id: role-resource-star, change: "s3:GetObject on every resource", patch: [{"op": "set", "node": "task_role", "path": "props.raw_policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["s3:GetObject"], "Resource": "*"}]}}], fires: [SEC-037], severity: warning }
  - { id: role-service-wildcard, change: "s3:* on one bucket", patch: [{"op": "set", "node": "task_role", "path": "props.raw_policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["s3:*"], "Resource": ["arn:aws:s3:::av2i-example-files"]}]}}], fires: [SEC-038], severity: warning }
  - { id: role-pass-role, change: "iam:PassRole on a role", patch: [{"op": "set", "node": "task_role", "path": "props.raw_policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["iam:PassRole"], "Resource": ["arn:aws:iam::123456789012:role/other"]}]}}], fires: [SEC-042], severity: error }
  - { id: ec2-with-role, change: "an instance that runs as a role", patch: [{"op": "add-node", "node": {"key": "inst", "label": "Bastion", "service": "ec2", "parent": "app_a", "props": {"ami": "ami-0123456789abcdef0", "instance_type": "t3.micro", "metadata_options": {"http_tokens": "required"}, "root_block_device": {"encrypted": true}}}}, {"op": "add-edge", "edge": {"id": "e_sg_inst", "mechanism": "sg-attach", "from": "sg_task", "to": "inst"}}, {"op": "add-node", "node": {"key": "inst_role", "label": "Instance role", "service": "iam-role", "props": {"name": "bastion"}}}, {"op": "add-edge", "edge": {"id": "e_inst_role", "mechanism": "assume-role", "from": "inst_role", "to": "inst"}}], fires: [], severity: info }
  - { id: ec2-two-roles, change: "an instance with two roles", patch: [{"op": "add-node", "node": {"key": "inst", "label": "Bastion", "service": "ec2", "parent": "app_a", "props": {"ami": "ami-0123456789abcdef0", "instance_type": "t3.micro", "metadata_options": {"http_tokens": "required"}, "root_block_device": {"encrypted": true}}}}, {"op": "add-edge", "edge": {"id": "e_sg_inst", "mechanism": "sg-attach", "from": "sg_task", "to": "inst"}}, {"op": "add-node", "node": {"key": "inst_role", "label": "Instance role", "service": "iam-role", "props": {"name": "bastion"}}}, {"op": "add-node", "node": {"key": "inst_role2", "label": "Second role", "service": "iam-role", "props": {"name": "bastion-2"}}}, {"op": "add-edge", "edge": {"id": "e_inst_role", "mechanism": "assume-role", "from": "inst_role", "to": "inst"}}, {"op": "add-edge", "edge": {"id": "e_inst_role2", "mechanism": "assume-role", "from": "inst_role2", "to": "inst"}}], fires: [VAL-109], severity: error }
---

# Container backend

The first design with containers, storage and a database, written for milestone M3 so that every new service and rule is
run by the test kit. It stands in for [container-service](container-service.md), which also needs a load balancer (M4):
an ECS Fargate service in two private subnets pulling its image from ECR, a Lambda function in the same subnets, a Multi-AZ
database that both reach through generated security group rules, an S3 bucket the task role may read and write, and a NAT
gateway per Availability Zone so that no private subnet depends on another zone.

## What the engine derives or generates

- The execution role of the service and the execution role of the function (decision D-025), with the managed policies
  their slots require; the function's role also holds the VPC permissions because the function is in subnets (SEC-008).
- Elastic IPs for both NAT gateways (D-030).
- Ingress on `sg_db` from `sg_task` and from `sg_fn` on port 5432, from the two `network-access` connections (D-012).
- The DB subnet group from the database's subnet and the one it is connected to.
- Task definition, with the image `repository_url:v1` from the `image-source` connection, and the service with explicit
  `desired_count`, `launch_type`, subnets, groups and `assign_public_ip` (D-005).
- One statement set on `task_role` from the `grant`: object actions on the bucket's objects, `ListBucket` on the bucket.
- Public Access Block, ownership controls, versioning and default encryption beside the bucket (D-016).

## Where the model bends the specification

- A service in several subnets and a function in a VPC take the extra subnets from `containment` edges drawn from the
  subnet to the workload; `parent` is the first subnet (DD-014).
- A database lives in the VPC and uses a DB subnet group, which is its own node: the subnets are drawn into it with `containment` edges from the subnet and the database is drawn to it with a `db-subnet-group` edge.
- An ECS node is a cluster or a service (`props.part`); the task definition is generated from the service (DD-014).
- A required role is derived when the slot is empty, so VAL-044 and the "no role" half of VAL-110 hold by construction;
  a role the user draws into a required slot must hold the managed policy itself (VAL-111, VAL-116).

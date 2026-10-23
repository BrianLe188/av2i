---
id: container-service
title: { vi: "Dịch vụ container: ALB, ECS Fargate, ECR, RDS", en: "Container service: ALB, ECS Fargate, ECR, RDS" }
services: [vpc, subnet, internet-gateway, nat-gateway, route-table, security-group, ecs, ecr, alb, rds, s3, iam-role, iam-policy]
nodes:
  - { id: vpc, service: vpc, props: { cidr_block: "10.2.0.0/16", enable_dns_support: true, enable_dns_hostnames: true } }
  - { id: pub-a, service: subnet }
  - { id: pub-b, service: subnet }
  - { id: priv-a, service: subnet }
  - { id: priv-b, service: subnet }
  - { id: nat-a, service: nat-gateway }
  - { id: nat-b, service: nat-gateway }
  - { id: alb, service: alb, props: { internal: false } }
  - { id: sg-alb, service: security-group }
  - { id: sg-task, service: security-group }
  - { id: sg-db, service: security-group }
  - { id: repo, service: ecr, props: { image_tag_mutability: IMMUTABLE, scan_on_push: true } }
  - { id: cluster, service: ecs, props: { part: cluster } }
  - { id: web, service: ecs, props: { part: service, cluster: cluster, cpu: "512", memory: "1024", desired_count: 2, launch_type: FARGATE, assign_public_ip: false, container_port: 8080 } }
  - { id: db, service: rds, props: { engine: postgres, multi_az: true } }
  - { id: files, service: s3 }
  - { id: task-role, service: iam-role }
  - { id: exec-role, service: iam-role }
connections:
  - { from: priv-a, to: web, mechanism: containment, kind: drawn, note: "tasks in priv-a and priv-b" }
  - { from: sg-task, to: web, mechanism: sg-attach, kind: drawn }
  - { from: alb, to: web, mechanism: listener-target, kind: drawn, note: "ip target group, container_name and container_port" }
  - { from: repo, to: web, mechanism: image-source, kind: drawn }
  - { from: web, to: db, mechanism: network-access, kind: drawn, note: "port 5432" }
  - { from: sg-task, to: sg-alb, mechanism: sg-reference, kind: generated }
  - { from: sg-db, to: sg-task, mechanism: sg-reference, kind: generated }
  - { from: exec-role, to: web, mechanism: assume-role, kind: derived, note: "execution slot, AmazonECSTaskExecutionRolePolicy" }
  - { from: task-role, to: web, mechanism: assume-role, kind: drawn, note: "task role slot" }
  - { from: task-role, to: files, mechanism: grant, kind: drawn, note: "level readwrite" }
expect:
  errors: []
  findings: [SEC-010, SEC-013, SEC-019, SEC-028]
variants:
  - { id: cpu-memory-mismatch, change: "cpu 256 with memory 4096", fires: [VAL-040], severity: error }
  - { id: no-pull-path, change: "private subnets with no NAT route and no ECR endpoint", fires: [VAL-042], severity: warning, note: "tasks stay PENDING" }
  - { id: too-many-groups, change: "6 security groups on the service", fires: [VAL-041, VAL-021], severity: error }
  - { id: instance-target-group, change: "the target group has target type instance", fires: [VAL-043], severity: error }
  - { id: no-execution-role, change: "web has no execution role", fires: [VAL-044], severity: error }
  - { id: execution-role-missing-policy, change: "exec-role lacks AmazonECSTaskExecutionRolePolicy", fires: [VAL-116], severity: error }
  - { id: no-task-role, change: "files is the target of a grant but web has no task role", fires: [VAL-112], severity: error }
  - { id: exec-without-ssm, change: "enable_execute_command true and the task role lacks the ssmmessages actions", fires: [VAL-113], severity: error }
  - { id: public-ip-private-subnet, change: "assign_public_ip true in priv-a", fires: [VAL-045, SEC-011], severity: warning }
  - { id: launch-type-and-strategy, change: "both launch_type and capacity_provider_strategy", fires: [VAL-046], severity: error }
  - { id: one-az, change: "tasks in priv-a only", fires: [VAL-037], severity: warning }
  - { id: subnets-other-vpc, change: "one task subnet belongs to another VPC", fires: [VAL-041, VAL-048], severity: error }
  - { id: mutable-latest, change: "repo MUTABLE and the image tag is latest", fires: [SEC-010], severity: info }
  - { id: two-lifecycle-policies, change: "two lifecycle policies on repo", fires: [VAL-047], severity: error }
  - { id: task-role-escalation, change: "task role allows iam:PassRole on *", fires: [SEC-042], severity: error }
  - { id: s3-from-task-edge, change: "a connection drawn from web to files with no role", fires: [], severity: error, note: "rejected by the matrix: ecs to s3 is none" }
---

# Container service

An ECS Fargate service in private subnets behind an internet-facing ALB, pulling its image from ECR and talking to a
Multi-AZ database. The ECS-specific content is the pair of roles and the image pull path.

## What the platform derives or generates

- **Two roles, two purposes** ([ecs](../services/ecs.md), [assume-role](../relations/assume-role.md)): `exec-role` is a required
  role (D-025) used by the agent to pull the image, write logs and read secrets; `task-role` is an application role drawn
  by the user and carries the S3 grant. The S3 permission must never be put on `exec-role`.
- The ECR pull permission needs no `grant`; `AmazonECSTaskExecutionRolePolicy` covers it ([image-source](../relations/image-source.md)).
- The service is created with `desired_count`, `launch_type = "FARGATE"`, an explicit security group and `assign_public_ip`
  set, because the provider defaults are wrong for this platform (D-005, [ecs](../services/ecs.md)).
- The target group is `ip`; ingress on `sg-task` is generated from the ALB group on the container port and the health check port.

## Edge cases this scenario exercises

| Case | Where it is decided |
|---|---|
| Task size must be a valid CPU/memory pair | VAL-040, [ecs](../services/ecs.md) |
| Image pull has no path from a private subnet | VAL-042, [egress-path](../relations/egress-path.md) |
| One ENI per task, so subnet addresses are consumed per task | [ecs](../services/ecs.md) behaviour; capacity is not checked by a rule |
| Autoscaling and `desired_count` | pitfalls: reset unless `ignore_changes` |
| Role policy destroyed before the service leaves it stuck `DRAINING` | pitfalls: `depends_on` the role policy |
| Container JSON diffs on formatting | D-013 structured subset first |

## Open points

Subnet address capacity for many tasks is not validated by any rule (one address per task plus ALB and endpoint interfaces).
It is listed under "Not yet checked" in [sources](../sources.md) as a candidate for a warning once subnet sizing is modelled.

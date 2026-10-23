---
id: ecs
title: { vi: "ECS (chạy container, Fargate)", en: "Amazon ECS on Fargate" }
terraform:
  resources: [aws_ecs_cluster, aws_ecs_task_definition, aws_ecs_service]
scope: regional
placement:
  requires: [vpc, subnet]
  subnet_type: private         # recommended; public only with a public IP per task
  min_azs: 2                   # recommended
sources:
  S1: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/ecs_cluster.html.markdown
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/ecs_task_definition.html.markdown
  S3: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/ecs_service.html.markdown
  S4: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html
  S5: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html
  S6: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html
scope_note: "Fargate only. EC2 launch type, Managed Instances, EXTERNAL, DAEMON, Service Connect, EFS/EBS volumes and blue/green are out of scope (decision D-011)"
parts:
  cluster:
    - { key: name, type: string, required: true, constraints: ["up to 255 letters, numbers, hyphens, underscores"], src: [S1], status: verified }
    - { key: setting.containerInsights, type: enum, values: [enhanced, enabled, disabled], src: [S1], status: verified }
  task_definition:
    - { key: family, type: string, required: true, src: [S2], status: verified }
    - { key: requires_compatibilities, type: list, value: [FARGATE], src: [S2, S4], status: verified }
    - { key: network_mode, type: enum, value: awsvpc, constraints: ["Fargate always uses awsvpc"], src: [S4, S5], status: verified }
    - { key: cpu, type: string, required: true, constraints: ["required for Fargate", "valid only with a matching memory value (see table)"], src: [S2, S4], status: verified }
    - { key: memory, type: string, required: true, constraints: ["required for Fargate"], src: [S2, S4], status: verified }
    - { key: runtime_platform, type: object, fields: { cpu_architecture: [X86_64, ARM64], operating_system_family: "required for Fargate" }, src: [S2, S4], status: verified }
    - { key: ephemeral_storage.size_in_gib, type: number, range: [21, 200], default: 20, src: [S2], status: verified, note: "the default of 20 GiB is from general knowledge; the provider page gives only the range" }
    - { key: container_definitions, type: json, required: true, constraints: ["one JSON document; each change creates a new task definition revision"], src: [S2], status: verified }
    - { key: execution_role_arn, type: reference, ref: iam-role, src: [S2, S6], status: verified }
    - { key: task_role_arn, type: reference, ref: iam-role, src: [S2, S6], status: verified }
  service:
    - { key: name, type: string, required: true, src: [S3], status: verified }
    - { key: cluster, type: reference, ref: ecs-cluster, src: [S3], status: verified }
    - { key: task_definition, type: reference, ref: ecs-task-definition, src: [S3], status: verified }
    - { key: desired_count, type: number, default: 0, constraints: ["the provider default is 0, so a service with no value runs no tasks"], src: [S3], status: verified }
    - { key: launch_type, type: enum, values: [FARGATE], constraints: ["conflicts with capacity_provider_strategy", "provider default is EC2, so FARGATE must be set"], src: [S3], status: verified }
    - { key: network_configuration.subnets, type: list, ref: subnet, required: true, constraints: ["1 to 16"], src: [S3, S5], status: verified }
    - { key: network_configuration.security_groups, type: list, ref: security-group, required: true, constraints: ["1 to 5", "the provider defaults to the VPC default group when omitted; this platform requires explicit groups (D-005)"], src: [S3, S5], status: verified }
    - { key: network_configuration.assign_public_ip, type: boolean, default: false, constraints: ["Fargate only"], src: [S3], status: verified }
    - { key: load_balancer, type: list, item: { target_group_arn: required, container_name: required, container_port: required }, constraints: ["Fargate supports Application and Network Load Balancers only", "target group target type must be ip"], src: [S3, S5], status: verified }
    - { key: health_check_grace_period_seconds, type: number, constraints: ["only with a load balancer"], src: [S3], status: verified }
    - { key: deployment_minimum_healthy_percent, type: number, src: [S3], status: verified }
    - { key: deployment_maximum_percent, type: number, src: [S3], status: verified }
    - { key: deployment_circuit_breaker, type: object, fields: { enable: required, rollback: required }, src: [S3], status: verified }
    - { key: platform_version, type: string, default: LATEST, src: [S3], status: verified }
    - { key: enable_execute_command, type: boolean, src: [S3], status: verified }
fargate_task_size:
  # CPU units -> allowed memory (S4)
  "256":   "512 MiB, 1 GB, 2 GB"
  "512":   "1 to 4 GB in 1 GB steps"
  "1024":  "2 to 8 GB in 1 GB steps"
  "2048":  "4 to 16 GB in 1 GB steps"
  "4096":  "8 to 30 GB in 1 GB steps"
  "8192":  "16 to 60 GB in 4 GB steps (Linux platform 1.4.0 or later)"
  "16384": "32 to 120 GB in 8 GB steps (Linux platform 1.4.0 or later)"
  "32768": "60, 120 or 244 GB (Linux platform 1.4.0 or later)"
limits:
  - { id: subnets_per_awsvpc_configuration, value: 16, adjustable: false, src: [S5], status: verified }
  - { id: security_groups_per_awsvpc_configuration, value: 5, adjustable: false, src: [S5], status: verified }
  - { id: eni_per_task, value: 1, adjustable: false, src: [S5], status: verified }
  - { id: placement_constraints_per_task_definition, value: 10, adjustable: false, src: [S2], status: verified, note: "not valid on Fargate (S4)" }
  - { id: other_quotas, value: "clusters, services, tasks, launch rates", adjustable: true, status: unverified, note: "the quotas page only links to the General Reference; numbers not read" }
relations: [containment, sg-attach, egress-path, image-source, network-access, listener-target, assume-role]
cost: { model: usage, notes: "vCPU and memory per second while tasks run; unverified. Plus NAT gateway if tasks are private and reach the internet" }
status: verified
---

# ECS on Fargate

## Purpose

Runs containers without managing servers. Use it for long-running services (web apps, APIs, workers) packaged as
container images. Compared with [ec2](ec2.md) there is no operating system to patch. Compared with
[lambda](lambda.md) there is no 15-minute limit and a process can keep state in memory.

Three resources make one service: a **cluster** (a logical grouping), a **task definition** (the blueprint: image,
CPU, memory, roles, ports) and a **service** (keeps N copies of a task running, optionally behind a load
balancer).

## Behaviour

- **One network interface per task.** Fargate tasks always use `awsvpc` mode. Each task gets its own ENI with a
  private IP in the chosen subnet, optionally a public IP in a public subnet. Security groups attach to that ENI
  (S4, S5).
- **Image pull needs a path.** A task must be able to reach its image registry. Options: a public subnet with a
  public IP on the task, a private subnet with a NAT gateway, or, for ECR, an interface VPC endpoint (S4, S5).
  Without one the task stays `PENDING` and fails to start.
- **Two roles, two purposes.** The **task execution role** is used by the Fargate agent: it pulls images from
  ECR, writes logs to CloudWatch with the `awslogs` driver, and reads secrets from Secrets Manager or SSM
  Parameter Store. The **task role** is used by the application code to call AWS services. The execution role's
  credentials are not visible to containers (S6). `AmazonECSTaskExecutionRolePolicy` covers the common
  execution needs; trust principal is `ecs-tasks.amazonaws.com` (S6).
- **Service-linked role.** ECS needs its service-linked role; it is created with a cluster or when a service is
  created in the console (S5).
- **Load balancing.** On Fargate only Application and Network Load Balancers work, and the target group's
  target type must be `ip` (S5).
- **Defaults to watch.** `desired_count` defaults to 0, `launch_type` to EC2, `assign_public_ip` to false, and
  `security_groups` to the VPC default group (S3). The platform sets all of them explicitly.
- **Task size.** CPU and memory must form a valid pair from the table above. Some sizes need Linux platform
  1.4.0 (S4).
- **Deployments.** A change to the container definition creates a new task definition revision and a new
  deployment of the service. `deployment_minimum_healthy_percent` and `deployment_maximum_percent` bound the
  running tasks during it (S2, S3).
- **Hostname.** Tasks get an Amazon DNS hostname only when the VPC has both DNS support and DNS hostnames on
  (S5).

## Placement

Tasks run in subnets of one VPC. Private subnets are the usual choice, with a NAT gateway or ECR endpoint for the
image pull. At least two AZs for availability. At least one explicit security group (D-005).

## Relations

- [containment](../relations/containment.md): the service's subnets.
- [sg-attach](../relations/sg-attach.md): `network_configuration.security_groups`.
- [egress-path](../relations/egress-path.md): image pull, log delivery, secrets.
- [image-source](../relations/image-source.md): container image from ECR.
- [network-access](../relations/network-access.md): other workloads that call this service or are called by it.
- listener-target: ALB forwards to the service's tasks; written with the ALB.
- [assume-role](../relations/assume-role.md): the **task role** (application permissions) and the **task execution role**
  (agent permissions); both trust `ecs-tasks.amazonaws.com`.
- [grant](../relations/grant.md): what the task role may do, including ECS Exec.

## Failure modes

| Situation | Result |
|---|---|
| CPU/memory pair not in the table | Rejected. Rule [VAL-040](../rules/validation.md) |
| Task in a private subnet with no NAT gateway or ECR endpoint | Cannot pull the image. Rule [VAL-042](../rules/validation.md) |
| More than 16 subnets or 5 security groups | Rejected (S5). Rule [VAL-041](../rules/validation.md) |
| Target group with target type `instance` | Rejected for Fargate (S5). Rule [VAL-043](../rules/validation.md) |
| `launch_type` together with `capacity_provider_strategy` | Conflict (S3). Rule [VAL-046](../rules/validation.md) |
| `DAEMON` scheduling on Fargate | Not supported (S3). Rule [VAL-046](../rules/validation.md) |
| No execution role but a private ECR image, `awslogs` or secrets | Task fails to start (S6). Rule [VAL-044](../rules/validation.md) |
| `assign_public_ip` in a private subnet | No effect on reachability. Rule [VAL-045](../rules/validation.md) |
| Role policy destroyed before the service | Service stuck in `DRAINING`; add `depends_on` the role policy (S3) |
| `desired_count` managed by autoscaling | Terraform resets it unless `ignore_changes = [desired_count]` (S3) |
| Changing `capacity_provider_strategy` | Needs `force_new_deployment = true` (S3) |
| Spurious diffs in `container_definitions` | The JSON document is the main source of changes, and formatting or escaping differences show up as diffs (S2) |

## Limits, cost, security

See front matter. Security: tasks with a public IP are reachable if security groups allow it
([SEC-011](../rules/security.md)). Keep application permissions in the task role, not the execution role (S6).

## Terraform mapping

`aws_ecs_cluster` (`name`, `setting`), `aws_ecs_task_definition` (`family`, `cpu`, `memory`, `network_mode =
"awsvpc"`, `requires_compatibilities = ["FARGATE"]`, `runtime_platform`, `execution_role_arn`,
`task_role_arn`, `container_definitions`), `aws_ecs_service` (`cluster`, `task_definition`, `desired_count`,
`launch_type = "FARGATE"`, `network_configuration`, `load_balancer`). Capacity providers are configured with a
separate resource (`aws_ecs_cluster_capacity_providers`); this page does not describe it (unverified).

## Sources

S1 to S6 in the front matter.

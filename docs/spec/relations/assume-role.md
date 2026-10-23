---
id: assume-role
title: { vi: "Workload chạy bằng role", en: "Assume role" }
participants:
  - { role: role, service: iam-role }
  - { role: consumer, service: [ec2, lambda, ecs, rds] }
direction: role->consumer
same_vpc: false
same_account: true               # PassRole works only inside one account (verified)
cardinality: { role: many, consumer: "one role per role-slot" }   # a role may serve several consumers; each slot of a consumer holds exactly one role
user_drawn: true                 # required roles (Lambda execution, ECS task execution) may also be derived (decision D-025)
consumers:
  # machine-readable registry. One row per role slot. Adding a service means adding rows, not changing code.
  - id: ec2-instance-profile
    service: ec2
    slot: instance profile
    trust_principal: ec2.amazonaws.com
    terraform: "aws_iam_instance_profile (role = role name) referenced by aws_instance.iam_instance_profile (profile name)"
    required: false
    required_managed_policies: []
    optional_managed_policies: ["AmazonSSMManagedInstanceCore (unverified)"]
    status: verified
  - id: lambda-execution
    service: lambda
    slot: execution role
    trust_principal: lambda.amazonaws.com
    terraform: "aws_lambda_function.role = role ARN"
    required: true
    required_managed_policies: ["AWSLambdaBasicExecutionRole (logs)", "AWSLambdaVPCAccessExecutionRole when vpc_config is set"]
    status: verified
  - id: ecs-task-role
    service: ecs
    slot: task role
    trust_principal: ecs-tasks.amazonaws.com
    terraform: "aws_ecs_task_definition.task_role_arn = role ARN"
    required: "when the application calls other AWS services"
    required_managed_policies: []
    trust_conditions: ["aws:SourceAccount = the account", "aws:SourceArn ArnLike arn:aws:ecs:<region>:<account>:* (a specific cluster is not supported)"]
    status: verified
  - id: ecs-task-execution
    service: ecs
    slot: task execution role
    trust_principal: ecs-tasks.amazonaws.com
    terraform: "aws_ecs_task_definition.execution_role_arn = role ARN"
    required: "when the image is in private ECR, logs use awslogs, or secrets are read"
    required_managed_policies: ["AmazonECSTaskExecutionRolePolicy"]
    status: verified
  - id: rds-enhanced-monitoring
    service: rds
    slot: monitoring role
    trust_principal: monitoring.rds.amazonaws.com
    terraform: "aws_db_instance.monitoring_role_arn = role ARN, with monitoring_interval > 0"
    required: "when monitoring_interval > 0"
    required_managed_policies: ["AmazonRDSEnhancedMonitoringRole"]
    status: verified          # trust principal and the policy name from the PassRole page; the ARN path is unverified
generates:
  - { terraform: "aws_iam_role with the trust policy listing every distinct consumer principal of the role", on: iam-role }
  - { terraform: "aws_iam_role_policy_attachment for each required managed policy", on: iam-role }
  - { terraform: "aws_iam_instance_profile", on: "ec2 only" }
  - { terraform: "the consumer's role argument", on: consumer }
conditions:
  - { text: { vi: "Role và consumer cùng một tài khoản AWS", en: "The role and the consumer are in the same AWS account" }, when: always }
  - { text: { vi: "Trust policy của role phải liệt kê service principal của consumer", en: "The role's trust policy must list the consumer's service principal" }, when: always }
invalid_when: [VAL-044, VAL-104, VAL-105, VAL-106, VAL-109, VAL-110, VAL-111, VAL-112, VAL-113, VAL-114, VAL-115, VAL-116]
sources:
  S1: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-service.html
  S2: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2_instance-profiles.html
  S3: https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html
  S4: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
  S5: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html
  S6: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html
  S7: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html
  S8: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/instance.html.markdown
  S9: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/lambda_function.html.markdown
  S10: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/ecs_task_definition.html.markdown
  S11: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/db_instance.html.markdown
status: verified          # unverified items are marked in the registry and cases
---

# Assume role

## Meaning

"This service runs as this role." The role's **trust policy** names the service principal that may assume it, and the
consumer is given the role's ARN (or, for EC2, an instance profile). From then on the consumer's code or agent receives
temporary credentials for the role and can do whatever the role's permission policies allow
([grant](grant.md)).

```
consumer (EC2 / Lambda / ECS task / RDS) --is given--> role --trust policy names--> service principal
                                                          \--permission policies--> what it may do
```

## The role slots

A consumer can have several **slots**, each with its own purpose. They are different roles for different jobs and
must not be confused:

| Consumer | Slot | Used by | Purpose |
|---|---|---|---|
| EC2 | instance profile role | the instance and the applications on it | application permissions (S2) |
| Lambda | execution role | the function, and Lambda itself to manage VPC interfaces | application permissions and logging (S3, S7) |
| ECS | **task role** | the application code in the containers | application permissions; required when the app calls other AWS services (S4) |
| ECS | **task execution role** | the Fargate and container agents, not visible to containers | pull the image, write logs, read secrets (S5) |
| RDS | monitoring role | RDS Enhanced Monitoring | write metrics to CloudWatch Logs (S6) |

The two ECS slots are the ones most often mixed up. Permissions for the application belong in the task role; the
execution role only needs what the agent needs, and `AmazonECSTaskExecutionRolePolicy` covers the common needs (S5). If
application code needs ECR itself, that goes in the task role, not the execution role (S4).

## Cases

| # | Situation | Result |
|---|---|---|
| 1 | EC2 instance with an instance-profile role | The role is wrapped in `aws_iam_instance_profile`; the instance takes the profile **name**. One role per profile (S2, S8) |
| 2 | EC2 instance with no role | Valid: the instance then has no AWS permissions |
| 3 | Role changed on a running instance | Replace the instance profile; removing a role from a profile can take up to an hour to apply; or stop and start, or disassociate and associate (S2) |
| 4 | Lambda function with no role | Invalid: `role` is required (S9). Rule [VAL-110](../rules/validation.md) |
| 5 | Lambda in a VPC, role without the VPC interface permissions | The function cannot be attached (S7). Rule [VAL-111](../rules/validation.md). Those permissions are also granted implicitly to the function's code ([SEC-008](../rules/security.md)) |
| 6 | Lambda: logs | `AWSLambdaBasicExecutionRole` is what the console attaches by default (S3) |
| 7 | ECS service whose app calls S3 or another service, no task role | The app has no credentials. Rule [VAL-112](../rules/validation.md) |
| 8 | ECS task definition with no execution role, private ECR image or `awslogs` or secrets | The task cannot start. Rule [VAL-044](../rules/validation.md); its role must hold the pull and log permissions, rule [VAL-116](../rules/validation.md) |
| 9 | ECS Exec enabled | The task role needs the four `ssmmessages` actions (S4). Rule [VAL-113](../rules/validation.md) |
| 10 | ECS task role trust | Trust `ecs-tasks.amazonaws.com`, with `aws:SourceAccount` and `aws:SourceArn` to prevent the confused deputy problem; `aws:SourceArn` cannot name a cluster, so use `arn:aws:ecs:<region>:<account>:*` (S4). [SEC-040](../rules/security.md) |
| 11 | One role used by several consumers of the same service | Allowed. The trust policy lists each distinct principal once; permissions apply to all of them. Prefer a role per task definition or service to keep least privilege (S4). [SEC-041](../rules/security.md) |
| 12 | One role used by consumers of different services (for example EC2 and Lambda) | Allowed; the trust policy lists both principals. The EC2 side still needs its own instance profile |
| 13 | A role assumed by nobody | The platform does not create it (nothing uses it). Rule [VAL-106](../rules/validation.md) |
| 14 | Role from another account | Not supported: `PassRole` works only in one account (S6). Rule [VAL-115](../rules/validation.md) |
| 15 | RDS with `monitoring_interval` above 0 | Needs a monitoring role trusting `monitoring.rds.amazonaws.com` with `AmazonRDSEnhancedMonitoringRole` (S6, S11). Rule [VAL-114](../rules/validation.md) |
| 16 | Code calls `sts:AssumeRole` to assume its own role | Not needed for Lambda and ECS (the service delivers credentials); if a role must assume itself, its trust policy must name itself (S3, S4) |
| 17 | Service-linked roles (ECS, ELB and others) | Created and owned by the service; not modelled (S1) |
| 18 | The deploying identity lacks `iam:PassRole` for the role | Creating the consumer fails. The platform lists the permissions it needs ([iam-role](../services/iam-role.md), D-028) |
| 19 | Role replaced while a consumer still uses it | The consumer must be updated first; for Lambda after a role is recreated an existing function can fail with `KMSAccessDeniedException` (S9 of [lambda](../services/lambda.md)). Pitfall P-024 |

## Failure modes

The usual ones: a trust policy that names the wrong service principal (the service cannot assume it), a missing
required slot (Lambda role, ECS execution role), the task role and execution role swapped, and a deployer that cannot
pass the role. All are design-time checks here.

## Terraform mapping

```hcl
data "aws_iam_policy_document" "trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals { type = "Service" identifiers = ["ecs-tasks.amazonaws.com"] }
    condition { test = "StringEquals" variable = "aws:SourceAccount" values = [data.aws_caller_identity.current.account_id] }
  }
}
resource "aws_iam_role" "task" { name = "app-task" assume_role_policy = data.aws_iam_policy_document.trust.json }
resource "aws_ecs_task_definition" "app" { task_role_arn = aws_iam_role.task.arn  execution_role_arn = aws_iam_role.exec.arn  # ... }
```

For EC2 add `aws_iam_instance_profile.app { role = aws_iam_role.app.name }` and
`aws_instance.iam_instance_profile = aws_iam_instance_profile.app.name`. The `aws_caller_identity` data source is
`unverified` here (not read). Illustrative shape.

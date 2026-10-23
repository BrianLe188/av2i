---
id: grant
title: { vi: "Cấp quyền cho role trên một tài nguyên", en: "Grant" }
participants:
  - { role: role, service: iam-role }
  - { role: target, service: [s3, ecr, rds] }
direction: role->target
same_vpc: false
same_account: true
cardinality: { role: many, target: many }
user_drawn: true
properties:
  level: { source: "the target's level list", default: "the target's default level" }
targets:
  # machine-readable registry. One row per kind of target. Adding a service means adding a row.
  - id: s3
    levels:
      read:
        statements:
          - { actions: ["s3:GetObject"], resource: "arn:aws:s3:::<bucket>/*" }
          - { actions: ["s3:ListBucket"], resource: "arn:aws:s3:::<bucket>" }
      readwrite:
        statements:
          - { actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], resource: "arn:aws:s3:::<bucket>/*" }
          - { actions: ["s3:ListBucket"], resource: "arn:aws:s3:::<bucket>" }
    default_level: read
    status: verified          # GetObject on <bucket>/*, ListBucket on <bucket> and PutObject are in the pages read; DeleteObject is general knowledge
  - id: ecr
    levels:
      pull:
        statements:
          - { actions: ["ecr:GetAuthorizationToken"], resource: "*" }
          - { actions: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"], resource: "<repository arn>" }
      push:
        statements:
          - { actions: ["ecr:GetAuthorizationToken"], resource: "*" }
          - { actions: ["ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"], resource: "<repository arn>" }
    default_level: pull
    note: "ECS task execution and Lambda image pulls need no explicit grant: the managed execution policy, or the Lambda service principal on the repository, covers them. Use this only when application code talks to ECR."
    status: verified
  - id: rds-iam-auth
    levels:
      connect:
        statements:
          - { actions: ["rds-db:connect"], resource: "arn:aws:rds-db:<region>:<account>:dbuser:<DbiResourceId>/<db user>" }
    default_level: connect
    requires: "iam_database_authentication_enabled on the instance"
    status: unverified        # the instance argument exists (verified); the action, resource format and requirement are general knowledge
  - id: secret
    levels: { read: { statements: [{ actions: ["secretsmanager:GetSecretValue"], resource: "<secret arn>" }] } }
    status: pending           # Tier 2: Secrets Manager. The action is from the ECS execution role page; held here to show the registry grows by rows
  - id: ecs-exec
    levels:
      exec:
        statements:
          - { actions: ["ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"], resource: "*" }
    note: "a feature of an ECS service (enable_execute_command), not a drawn connection; modelled as a grant on the task role so rule VAL-113 can check it"
    status: verified
generates:
  - { terraform: "aws_iam_role_policy (inline policy named grants) or one aws_iam_policy attached to the role, built from the registry rows, grouped by action set and resource", on: iam-role }
conditions:
  - { text: { vi: "Role phải do ít nhất một consumer chạy bằng; nếu không thì không được tạo", en: "The role must be assumed by at least one consumer, or it is not emitted" }, when: always }
  - { text: { vi: "Resource trong statement là ARN cụ thể, không dùng *", en: "Statement resources are specific ARNs, not *" }, when: "except ecr:GetAuthorizationToken and ssmmessages, which require *" }
invalid_when: [VAL-070, VAL-106, VAL-107, VAL-108, VAL-112, VAL-113, VAL-119]
sources:
  S1: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html
  S2: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
  S3: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
  S4: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html
  S5: https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policy-examples.html
  S6: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-service.html
  S7: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
  S8: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/db_instance.html.markdown
status: verified          # the rds-iam-auth row and DeleteObject are unverified
---

# Grant

## Meaning

A **grant** says what a role may do on a target: "this role may read and write that bucket". The platform turns it
into policy statements on the role, with specific actions and the target's exact ARN. Together with
[assume-role](assume-role.md) it replaces any direct line from a workload to a service: an EC2 instance, a Lambda
function or an ECS task never reaches S3 or ECR "directly"; it runs as a role, and the role is granted access.

```
EC2 / Lambda / ECS task --assume-role--> role --grant (read | readwrite)--> S3 bucket
```

## Why a grant is enough inside one account

Inside one account, an allow in the role's identity-based policy is sufficient; the target needs no matching
resource-based policy. Across accounts, both sides must allow (S1). So a same-account S3 read needs only the grant, not
a bucket policy. Resource-based policies ([resource-policy](resource-policy.md)) are for principals that have no role:
CloudFront, a load balancer writing logs.

## Cases

| # | Situation | Result |
|---|---|---|
| 1 | Role granted `read` on a bucket | `s3:GetObject` on the objects and `s3:ListBucket` on the bucket. Object actions use the `/*` ARN, bucket actions the bucket ARN; using one ARN for both is the common mistake (S3 example uses `<bucket>/*`; the EC2 example uses the bare bucket for `ListBucket`) |
| 2 | Role granted `readwrite` on a bucket | Adds `s3:PutObject` and `s3:DeleteObject` on the objects |
| 3 | Two grants to the same bucket from one role | Merge into one statement set; the stronger level wins |
| 4 | Several buckets | One statement group per bucket, resources listed exactly |
| 5 | Bucket encrypted with SSE-KMS | The role also needs permission on the KMS key; KMS is Tier 2 (S7 for the CloudFront case, same principle) |
| 6 | Workload in a private subnet | The grant allows the call but the network path must exist: NAT or an S3 gateway endpoint. Rule [VAL-070](../rules/validation.md) |
| 7 | Role used by an ECS service | The grant goes on the **task role**, not the execution role (S3, S4) |
| 8 | Role used by Lambda | The execution role is the role; grants are added to it ([assume-role](assume-role.md), case 6) |
| 9 | Role used by EC2 | The instance-profile role; grants apply to the applications on the instance |
| 10 | ECR image pull by an ECS task | No grant needed; `AmazonECSTaskExecutionRolePolicy` on the execution role covers it (S4). A grant on the task role is only for code that calls ECR itself (S3) |
| 11 | ECR image pull by Lambda | The Lambda service principal on the repository, or the role's identity policy, covers it ([image-source](image-source.md)) |
| 12 | `ecr:GetAuthorizationToken` | Always `Resource: "*"`, and it must come from an identity policy, never a repository policy (S5) |
| 13 | RDS IAM database authentication | `rds-db:connect` on the database user's ARN, with the feature on the instance (`unverified`) |
| 14 | Grant to a role that no consumer assumes | The role is not emitted, so the grant is dropped with a warning. Rule [VAL-106](../rules/validation.md) |
| 15 | Target in another account | Out of scope: both sides would have to allow (S1) |
| 16 | Role with many grants | Statements are grouped by action set; keep the role under the size limits: inline total 10,240 characters, a managed policy 6,144, 20 managed policies. Rules [VAL-107](../rules/validation.md), [VAL-108](../rules/validation.md) |
| 17 | User asks for `Resource: "*"` or `s3:*` | Possible through the raw-JSON escape hatch (D-026) and flagged [SEC-036](../rules/security.md), [SEC-037](../rules/security.md), [SEC-038](../rules/security.md) |
| 18 | A grant for a service this registry lacks | Add a row to the registry (actions, resource ARN pattern, levels); no other change |
| 19 | The old direct EC2-to-S3 or Lambda-to-S3 line | Not a relation in this specification. It maps to assume-role plus grant, and a design that has only the line is invalid until a role is added |

## Failure modes

An AWS call returns `AccessDenied` when the action is missing, the resource ARN is wrong (bucket vs object), the
workload runs as a different role than assumed, an explicit deny exists, or the network path is missing (which shows as
a timeout, not a denial). The design-time checks above cover the first three and the last.

## Terraform mapping

```hcl
data "aws_iam_policy_document" "grants" {
  statement { sid = "s3ReadWrite" actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"] resources = ["${aws_s3_bucket.data.arn}/*"] }
  statement { sid = "s3List"      actions = ["s3:ListBucket"]                                  resources = [aws_s3_bucket.data.arn] }
}
resource "aws_iam_role_policy" "grants" { name = "grants" role = aws_iam_role.app.name policy = data.aws_iam_policy_document.grants.json }
```

One inline policy named `grants` per role, built from the registry. Statement `sid`s come from the target and level so
a regenerated policy diffs cleanly. Illustrative; see [iam-policy](../services/iam-policy.md).

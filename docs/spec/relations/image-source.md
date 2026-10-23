---
id: image-source
title: { vi: "Nguồn container image", en: "Image source" }
participants:
  - { role: registry, service: ecr }
  - { role: consumer, service: [ecs, lambda] }
direction: registry->consumer
same_vpc: false
same_region: true                  # required for Lambda (S3); ECS pulls by URL, same Region recommended (unverified)
cardinality: { registry: many, consumer: many }   # a repository serves many consumers; a task definition container or a function uses one image
user_drawn: true
generates:
  - { terraform: "image (container_definitions JSON) = \"<repository_url>:<tag or @digest>\"", on: ecs }
  - { terraform: "image_uri = \"<repository_url>:<tag or @digest>\", package_type = \"Image\"", on: lambda }
  - { terraform: "pull permission", on: "ecs task execution role, lambda service or execution role", via: grant }
conditions:
  - { text: { vi: "Lambda chỉ dùng repository ECR cùng Region", en: "Lambda can use only a repository in its own Region" }, when: "consumer is lambda" }
  - { text: { vi: "Task Fargate cần đường ra để kéo image (NAT, IP công khai, hoặc VPC endpoint của ECR)", en: "A Fargate task needs a path to pull the image (NAT, public IP, or an ECR VPC endpoint)" }, when: "consumer is ecs" }
invalid_when: [VAL-035, VAL-042, VAL-044]
sources:
  S1: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html
  S2: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html
  S3: https://docs.aws.amazon.com/lambda/latest/dg/images-create.html
  S4: https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policy-examples.html
  S5: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/lambda_function.html.markdown
status: verified          # same-Region behaviour for ECS and architecture matching for ECS are unverified
---

# Image source

## Meaning

A container service takes its image from an ECR repository. The connection fixes three things: the image
reference written into the consumer, the permission to pull it, and the network path the pull uses.

## Cases

| # | Situation | Result |
|---|---|---|
| 1 | ECS task, same account, execution role with ECR pull permissions | Works. The managed execution policy has the needed actions (S1) |
| 2 | ECS task with no execution role | Cannot pull from a private repository. Rule [VAL-044](../rules/validation.md) |
| 3 | ECS task in a private subnet, no NAT gateway, no ECR endpoint | Image pull fails. Rule [VAL-042](../rules/validation.md) |
| 4 | ECS task in a public subnet without a public IP and no NAT | Same failure; a public subnet alone is not enough (S2) |
| 5 | ECS task in a public subnet with `assign_public_ip` | Works through the internet gateway (S2) |
| 6 | ECS task, ECR interface endpoint present | Pull uses the task's private address (S2). Endpoint is a Tier 2 service |
| 7 | Lambda, same account and Region | Works. Lambda needs `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer`, from the repository policy or the role; it can add the repository policy itself if the caller may set it (S3) |
| 8 | Lambda, repository in another Region | Rejected (S3). Rule [VAL-035](../rules/validation.md) |
| 9 | Lambda, repository in another account, same Region | Allowed; both the repository policy and the role's identity policy must allow (S3). Out of scope for the first version |
| 10 | Lambda image with several architectures | Rejected; one architecture per function (S3) |
| 11 | Image tag `latest` (mutable) | The next task launch or function update uses whatever the tag points to now. Prefer a digest or an immutable tag ([SEC-010](../rules/security.md)) |
| 12 | Image from a registry other than private ECR | Needs registry credentials in Secrets Manager (ECS) or is not allowed (Lambda). Out of scope (S1, S3) |
| 13 | Repository deleted or permission removed while in use | Lambda function enters `Failed` (S3); new ECS tasks cannot start |
| 14 | Consumer with an ECR FIPS endpoint URI | Lambda does not support it (S3) |

## Failure modes

See the cases. In Terraform, reference `aws_ecr_repository.<x>.repository_url` so the repository exists before
the consumer; the image tag itself is not known to Terraform and must be pushed before the consumer starts.
A consumer created before the first image is pushed fails to start (ECS) or to create (Lambda).

## Terraform mapping

ECS: the `image` field inside `container_definitions` of `aws_ecs_task_definition`. Lambda: `image_uri` on
`aws_lambda_function` with `package_type = "Image"` (S5). The pull permission is a `grant` on the consumer's
role (see the IAM group).

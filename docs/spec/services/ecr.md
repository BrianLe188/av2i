---
id: ecr
title: { vi: "ECR (kho lưu container image)", en: "Amazon ECR private repository" }
terraform:
  resources: [aws_ecr_repository, aws_ecr_lifecycle_policy]
scope: regional
placement: { requires: [], subnet_type: null, min_azs: null }
sources:
  S1: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/ecr_repository.html.markdown
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/ecr_lifecycle_policy.html.markdown
  S3: https://docs.aws.amazon.com/AmazonECR/latest/userguide/service-quotas.html
  S4: https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policy-examples.html
  S5: https://docs.aws.amazon.com/lambda/latest/dg/images-create.html
  S6: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html
scope_note: "Private repositories only. ECR Public, pull-through cache and replication are out of scope"
properties:
  - key: name
    type: string
    required: true
    src: [S1]
    status: verified
  - key: image_tag_mutability
    type: enum
    values: [MUTABLE, IMMUTABLE, IMMUTABLE_WITH_EXCLUSION, MUTABLE_WITH_EXCLUSION]
    default: MUTABLE
    constraints: ["an exclusion filter applies only to the two *_WITH_EXCLUSION values; up to 128 characters and 2 wildcards"]
    src: [S1]
    status: verified
  - key: image_scanning_configuration.scan_on_push
    type: boolean
    default: false
    constraints: ["when off, scans must be started manually"]
    src: [S1]
    status: verified
  - key: encryption_configuration
    type: object
    fields: { encryption_type: { values: [AES256, KMS], default: AES256 }, kms_key: "ARN; default AWS managed key when omitted" }
    src: [S1]
    status: verified
  - key: force_delete
    type: boolean
    default: false
    constraints: ["when false, a repository that still holds images cannot be deleted"]
    src: [S1]
    status: verified
  - key: lifecycle_policy
    type: json
    constraints:
      - "one aws_ecr_lifecycle_policy per repository; combine rules in one document"
      - "rules sorted by ascending rulePriority, otherwise Terraform sees a change every plan"
      - "at most 50 rules; at most 30,720 characters"
      - "selection.tagStatus: untagged | tagged | any; countType: imageCountMoreThan | sinceImagePushed | sinceImagePulled | sinceImageTransitioned; action.type: expire | transition"
    src: [S2, S3]
    status: verified
exported:
  - { key: repository_url, format: "<account>.dkr.ecr.<region>.amazonaws.com/<name>", src: [S1] }
  - { key: arn, src: [S1] }
  - { key: registry_id, src: [S1] }
limits:
  - { id: repositories_per_region, value: 100000, adjustable: true, src: [S3], status: verified }
  - { id: images_per_repository, value: 100000, adjustable: true, src: [S3], status: verified }
  - { id: lifecycle_rules_per_policy, value: 50, adjustable: false, src: [S3], status: verified }
  - { id: lifecycle_policy_length, value: 30720, adjustable: false, src: [S3], status: verified }
  - { id: max_layer_size_mib, value: 52000, adjustable: false, src: [S3], status: verified }
  - { id: tags_per_image, value: 1000, adjustable: false, src: [S3], status: verified }
  - { id: basic_scans_per_24h, value: 100000, adjustable: false, src: [S3], status: verified }
  - { id: scans_per_image_per_24h, value: 1, adjustable: false, src: [S3], status: verified }
  - { id: pull_api_rates, value: "BatchGetImage 2000/s, GetDownloadUrlForLayer 3000/s, GetAuthorizationToken 500/s", adjustable: true, src: [S3], status: verified }
relations: [image-source, resource-policy, grant]
cost: { model: usage, notes: "storage and data transfer; unverified" }
status: verified
---

# ECR private repository

## Purpose

Stores container images for [ecs](ecs.md) and [lambda](lambda.md). Using ECR instead of a public registry
avoids public registry rate limits and keeps image pulls inside AWS, which shortens pull times and reduces data
transfer charges when traffic would otherwise leave the VPC (S6).

## Behaviour

- **Address.** Images are pulled and pushed through `repository_url`, which has the form
  `<account>.dkr.ecr.<region>.amazonaws.com/<name>` (S1).
- **Tag mutability.** `MUTABLE` by default: a tag such as `latest` can be overwritten. `IMMUTABLE` rejects a
  push of an existing tag (S1). The `*_WITH_EXCLUSION` modes allow named exceptions (S1).
- **Scanning.** Off on push by default; scans must then be started by hand. A basic scan is limited to one per
  image per 24 hours (S1, S3).
- **Access control** has two layers. IAM identity policies grant actions to roles and users; a **repository
  policy** on the repository grants them to principals. In the same account either one is enough; across
  accounts both must allow (S5). Every pull or push also needs `ecr:GetAuthorizationToken` through an IAM
  policy, which cannot come from a repository policy (S4).
- **Pull actions** are `ecr:GetAuthorizationToken`, `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer`.
  The Lambda service principal needs the last two on the repository or on the role (S4, S5). The ECS task
  execution role needs all three; the managed `AmazonECSTaskExecutionRolePolicy` includes them (S6).
- **Lifecycle policy** expires or transitions images by count or age. Only one per repository (S2).
- **Region.** A Lambda function must use a repository in its own Region (S5).
- **Deleting.** A repository with images cannot be deleted unless `force_delete` is true (S1).

## Placement

Regional, outside any VPC. Reached over the internet or an ECR interface VPC endpoint (S6); the endpoint is a
Tier 2 service.

## Relations

- [image-source](../relations/image-source.md): consumed by ECS tasks and Lambda functions.
- [resource-policy](../relations/resource-policy.md): a repository policy.
- [grant](../relations/grant.md): a role allowed to pull or push, only for application code that talks to ECR; image pulls
  by ECS and Lambda need no explicit grant.

## Failure modes

| Situation | Result |
|---|---|
| Consumer in another Region (Lambda) | Rejected (S5). Rule [VAL-035](../rules/validation.md) |
| Cross-account pull with only one side allowing | Denied; both sides must allow (S5) |
| Lifecycle rules not sorted by priority | Resource replaced on every plan (S2). Pitfall P-033 |
| More than one lifecycle policy on a repository | Not possible (S2). Rule [VAL-047](../rules/validation.md) |
| Lifecycle policy above 50 rules or 30,720 characters | Rejected (S3). Rule [VAL-047](../rules/validation.md) |
| Delete with images present and `force_delete` false | Delete fails (S1) |
| Mutable tag overwritten while a service still points at it | Running tasks keep the old image until redeployed; the next launch pulls the new one |
| Image removed or permission revoked while a Lambda function uses it | Function enters `Failed` state (S5) |

## Limits, cost, security

See front matter. Security: use immutable tags or digests for production ([SEC-010](../rules/security.md)),
scan on push ([SEC-009](../rules/security.md)), and restrict repository policies to the accounts that need them
(S5).

## Terraform mapping

`aws_ecr_repository` (`name`, `image_tag_mutability`, `image_scanning_configuration`,
`encryption_configuration`, `force_delete`) and, optionally, one `aws_ecr_lifecycle_policy` (`repository`,
`policy`). Reference `aws_ecr_repository.<x>.repository_url` for `image` and `image_uri` (S1, S2).

## Sources

S1 to S6 in the front matter.

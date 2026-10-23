---
id: resource-policy
title: { vi: "Policy gắn trên resource", en: "Resource-based policy" }
participants:
  - { role: target, service: [s3, lambda, ecr] }                # resources that carry a policy; more join with Tier 2
  - { role: principal, service: [cloudfront, alb, "aws service principals", "other accounts"] }
direction: target<-principal
same_vpc: false
cardinality: { target: many, principal: many }
user_drawn: partly                 # CloudFront-to-S3 and ALB logging are drawn connections; the policy text is generated
generates:
  - { terraform: "aws_s3_bucket_policy (one per bucket, statements merged)", on: s3 }
  - { terraform: "aws_lambda_permission (one per invoker)", on: lambda }
  - { terraform: "aws_ecr_repository_policy", on: ecr, status: unverified }
properties:
  statement:
    sid: "derived from the relation ID so it can be added and removed without touching other statements"
    principal: "a service principal (cloudfront.amazonaws.com, logdelivery.elasticloadbalancing.amazonaws.com, lambda.amazonaws.com), an account or a role ARN"
    condition: "a fixed value for aws:SourceArn or aws:SourceAccount whenever the principal is a service"
merge_rule: "A bucket has at most one policy resource. The platform collects every statement that every relation wants on that bucket and emits one document, ordered by Sid. Never emit two policy resources for one bucket."
invalid_when: [VAL-051, VAL-052, VAL-053, VAL-054, VAL-055]
sources:
  S1: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/s3_bucket_policy.html.markdown
  S2: https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html
  S3: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
  S4: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html
  S5: https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html
  S6: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/lambda_permission.html.markdown
  S7: https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policy-examples.html
  S8: https://docs.aws.amazon.com/lambda/latest/dg/images-create.html
status: verified          # sections marked unverified below; the CloudFront and ECS-side detail is completed with those files
---

# Resource-based policy

## Meaning

Most access in this specification goes through an IAM role: a workload runs as a role ([assume-role](assume-role.md))
and the role is granted actions on a target ([grant](grant.md)). A resource-based policy is different. It sits on the **target** and names
who may use it, so no role of the caller is involved. It is how an AWS **service** is allowed to touch your
resource: CloudFront reading a bucket, a load balancer writing access logs, a Lambda function being invoked.
Modelling those as `grant` would be wrong, because there is no role to attach to.

## S3 bucket policy

A bucket policy is a JSON document on the bucket, set only by the bucket owner, at most 20 KB, and every statement
needs a Principal (S1, S2). **Only one `aws_s3_bucket_policy` per bucket**: it uses `PutBucketPolicy`, which
replaces the whole policy without warning, so the last resource applied silently wins (S1). The platform therefore
builds one document per bucket from all the relations that need a statement.

### Cases

| # | Principal | Purpose | Statement shape | Conditions and prerequisites |
|---|---|---|---|---|
| 1 | `cloudfront.amazonaws.com` | CloudFront reads objects through origin access control (OAC) | Allow `s3:GetObject` on `<bucket>/*` | Condition `AWS:SourceArn` = the distribution ARN, a fixed value (S3). The bucket must be a regular bucket, not a website endpoint (S3). Object Ownership must be Bucket owner enforced (default) or Bucket owner preferred (S3). The statement needs the distribution to exist, so it is created after it |
| 2 | `cloudfront.amazonaws.com` | CloudFront also writes (PUT/DELETE) | Allow `s3:GetObject` and `s3:PutObject` | Same condition (S3) |
| 3 | `cloudfront.amazonaws.com`, bucket encrypted with SSE-KMS | Decrypt objects | The bucket policy is not enough: the KMS key policy needs `kms:Decrypt`, `kms:Encrypt`, `kms:GenerateDataKey*` for the same principal and condition (S3). KMS is Tier 2 | OAC supports SSE-KMS, the older origin access identity does not (S3) |
| 4 | Several distributions use one bucket | One statement per distribution, each with its own `AWS:SourceArn` | Merge into the one policy | A wildcard source would make the policy public |
| 5 | Origin access identity (legacy) | Same as case 1 with an OAI principal | Not supported by the platform; OAC replaces it (S3) |
| 6 | `logdelivery.elasticloadbalancing.amazonaws.com` | An Application Load Balancer writes access logs | Allow `s3:PutObject` on `<bucket>/<prefix>/AWSLogs/<account-id>/*` | Bucket in the same Region as the load balancer; default encryption must be SSE-S3 only; no prefix may contain "AWSLogs"; use the full resource path with the account ID and no wildcard in it (S4). Add `aws:SourceArn` for the load balancer's Region and account as a best practice (S4) |
| 7 | Older Regions' ELB account principals | Legacy form of case 6 | Still works for regions before August 2022, not generated here (S4) |
| 8 | A statement with `Principal: "*"` and no fixed condition | Public read | The whole policy is then public (S5). It is accepted only if `block_public_policy` is off. Rule [VAL-052](../rules/validation.md) |
| 9 | A statement with a fixed account or role principal | Cross-account access | Non-public (S5). Cross-account also needs the other side's identity policy; out of scope here |
| 10 | Disabling a load balancer's access logging before deleting the log bucket | Avoids a stranger recreating the same bucket name and receiving logs | Ordering rule on destroy (S4) |
| 11 | Policy tries to deny an S3 Lifecycle action | No effect: lifecycle rules still run (S2) | |

### Failure modes

- Two policy resources for one bucket overwrite each other (S1). Rule [VAL-051](../rules/validation.md).
- A public policy is rejected while `block_public_policy` is true (S5). Rule [VAL-052](../rules/validation.md).
- A policy over 20 KB is rejected (S1). Rule [VAL-053](../rules/validation.md).
- Case 1 or 2 on a bucket that is a website endpoint, or with ACL-only ownership (`ObjectWriter`), does not work
  (S3). Rule [VAL-054](../rules/validation.md).
- Case 6 on a bucket in another Region or with SSE-KMS default encryption: delivery fails or writes objects you
  cannot read (S4). Rule [VAL-055](../rules/validation.md).
- A bucket policy cannot allow what Block Public Access forbids; Block Public Access wins (S5).

## Lambda permission

A function has its own resource-based policy, managed with `aws_lambda_permission`: `action`
(`lambda:InvokeFunction`), `function_name`, `principal`, and optionally `source_arn`, `source_account`,
`qualifier` (S6). It is how an ALB, S3, EventBridge, SNS or API Gateway is allowed to call a function. It is
separate from the function's execution role, which only says what the function may do (S6 of [lambda](../services/lambda.md)).
The function policy is limited to 20 KB (S2 of [lambda](../services/lambda.md)). For API Gateway the `source_arn` is the
API's execution ARN with `/*`; for CloudWatch Logs the log group ARN with `:*` (S6). Whether S3 needs
`source_account` is not stated on the page read and must be checked (`unverified`). Statements are recreated when
the function changes, using `replace_triggered_by` (S6). The principal for an ALB target is `elasticloadbalancing.amazonaws.com`, and the target group attachment must
depend on the permission (verified, [alb](../services/alb.md) S4). The principals of other triggers (S3, EventBridge, SNS,
API Gateway) remain `unverified` until those services are written.

## ECR repository policy

Controls who may push and pull a repository, as a subset of IAM policy scoped to one repository (S7). Same account:
the repository policy or the role's identity policy is enough; across accounts both must allow
([ecr](../services/ecr.md), S8 here). Lambda pulls images through a statement for the `lambda.amazonaws.com`
principal with `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer`, which Lambda can add itself if the caller may
call `ecr:SetRepositoryPolicy` (S8). `ecr:GetAuthorizationToken` can never come from a repository policy; it needs
an identity policy (S7).

## Terraform mapping

`aws_s3_bucket_policy` with `bucket` and `policy`. Build the policy with `jsonencode` of the merged statement
list, in stable order. Create it after the bucket, the public access block and every resource whose ARN a
statement mentions (distribution, load balancer). The relation is a separate resource precisely so that the
bucket does not depend on the distribution while the policy depends on both (inferred, `unverified`).

---
id: iam-policy
title: { vi: "IAM Policy (chính sách quyền)", en: "IAM policy and policy document" }
terraform:
  resources: [aws_iam_policy, aws_iam_role_policy]
  data_sources: [aws_iam_policy_document]
scope: global
placement: { requires: [], subnet_type: null, min_azs: null }
sources:
  S1: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/iam_policy.html.markdown
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/d/iam_policy_document.html.markdown
  S3: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html
  S4: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html
  S5: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
  S6: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html
scope_note: "Identity-based policies on roles (AWS managed policies, customer managed policies, inline policies) and the policy document structure shared with resource-based policies. Policies for users and groups, session policies, permissions boundaries, SCPs and RCPs are out of scope (decision D-024)"
properties:
  # what a customer managed policy node carries in props (kinds.customer_managed below); a role holds it through a grant connection
  - { key: name, type: string, constraints: ["at most 128 characters"], src: [S1, S3], status: verified, note: "defaults to the node key with hyphens" }
  - { key: description, type: string, src: [S1], status: verified }
  - { key: policy, type: json, required: true, constraints: ["the policy document; at most 6,144 characters, white space not counted"], src: [S1, S3], status: verified }
kinds:
  aws_managed:
    description: "Created and maintained by AWS, attached by ARN. A good start, but they are written for every customer and may grant more than a workload needs (S5)."
    examples_used:
      - { name: AWSLambdaBasicExecutionRole, arn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole", purpose: "write logs to CloudWatch Logs", status: verified }
      - { name: AWSLambdaVPCAccessExecutionRole, arn: "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole", purpose: "create and manage the network interfaces a VPC-attached function needs", status: unverified, note: "name verified on the Lambda VPC page; the ARN path is assumed from the pattern of the other two" }
      - { name: AmazonECSTaskExecutionRolePolicy, arn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy", purpose: "pull ECR images and write awslogs logs", status: verified }
      - { name: AmazonRDSEnhancedMonitoringRole, arn: "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole", purpose: "RDS Enhanced Monitoring writes metrics to CloudWatch Logs", status: unverified, note: "name verified on the PassRole page; ARN path assumed" }
      - { name: AmazonSSMManagedInstanceCore, arn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore", purpose: "Systems Manager access to an instance", status: unverified, note: "not read" }
      - { name: AdministratorAccess, arn: "arn:aws:iam::aws:policy/AdministratorAccess", purpose: "full access to the account; never attached by the platform", status: verified }
  customer_managed:
    resource: aws_iam_policy
    properties:
      - { key: name, type: string, force_new: true, constraints: ["at most 128 characters"], src: [S1, S3], status: verified }
      - { key: description, type: string, force_new: true, src: [S1], status: verified }
      - { key: path, type: string, default: "/", src: [S1], status: verified }
      - { key: policy, type: json, required: true, constraints: ["at most 6,144 characters, white space not counted"], src: [S1, S3], status: verified }
    limits: ["1,500 per account (adjustable to 10,000)", "attached to at most 20 managed policies per role (25 at most)"]
  inline:
    resource: aws_iam_role_policy
    constraints: ["belongs to one role; the sum of all inline policies on a role is at most 10,240 characters", "name unique within the role"]
policy_document:
  version: { values: ["2012-10-17", "2008-10-17"], default: "2012-10-17", src: [S2], status: verified }
  statement:
    sid: { constraints: ["a statement can be overridden only if it has a non-blank sid", "documents merged with source_policy_documents need unique sids"], src: [S2], status: verified }
    effect: { values: [Allow, Deny], default: Allow, src: [S2], status: verified }
    actions: { src: [S2], status: verified }
    not_actions: { src: [S2], status: verified }
    resources: { constraints: ["AWS requires it in IAM policies", "conflicts with not_resources"], src: [S2], status: verified }
    principals: { types: [AWS, Service, Federated, CanonicalUser, "*"], constraints: ["used in resource-based and trust policies"], src: [S2], status: verified }
    condition: { constraints: ["each block needs test, variable and values", "several condition blocks are ANDed, several values in one block are ORed"], src: [S2], status: verified }
limits:
  - { id: customer_managed_policies_per_account, value: 1500, adjustable: true, max: 10000, src: [S3], status: verified }
  - { id: managed_policy_size, value: 6144, adjustable: false, src: [S3], status: verified, note: "characters, white space not counted" }
  - { id: policy_name_length, value: 128, adjustable: false, src: [S3], status: verified }
  - { id: policy_document_characters, value: "tab, line feed, carriage return and U+0020 to U+00FF only", adjustable: false, src: [S3], status: verified }
relations: [grant]
cost: { model: free, notes: "" }
status: verified
---

# IAM policy

## Purpose

A policy is a JSON document that says which **actions** are allowed or denied on which **resources**, optionally
under **conditions**. This specification uses three forms, always attached to a role:

- **AWS managed policies**, attached by ARN: a ready-made starting point for common needs (S5).
- **Customer managed policies** (`aws_iam_policy`): your own reusable document, attached to one or more roles.
- **Inline policies** (`aws_iam_role_policy`): a document that belongs to exactly one role and is deleted with it.

The same document language is used for **trust policies** ([iam-role](iam-role.md)) and **resource-based policies**
([resource-policy](../relations/resource-policy.md)); the difference is whether the statement names a `Principal`.

## Behaviour

- **Default deny.** Nothing is allowed until a policy allows it, and an explicit `Deny` in any applicable policy
  overrides every `Allow` (S4).
- **Same account:** the effective permission is the union of identity-based and resource-based policies, so an allow
  in either is enough. A permissions boundary or an organization policy only narrows (S4).
- **Least privilege.** Grant only what a task needs, on specific resources and under conditions where possible. Start
  from AWS managed policies and move towards narrower customer managed ones, and use IAM Access Analyzer to generate
  policies from observed activity and to validate them (S5).
- **Statement elements.** `Effect`, `Action` or `NotAction`, `Resource` or `NotResource`, optional `Condition`, and,
  in resource-based and trust policies, `Principal`. `Resource` is required in an identity policy (S2). Policy
  variables such as `${aws:username}` collide with Terraform interpolation; write them as `&{aws:username}` in the
  data source (S2).
- **Principal `*` is not one thing.** `"Principal": "*"` and `"Principal": {"AWS": "*"}` can behave differently, for
  example in a role trust policy, so they are written distinctly (S2).
- **Size.** A managed policy is at most 6,144 characters; all inline policies on a role together at most 10,240; a
  trust policy 2,048 by default. White space does not count (S3).
- **Character set.** A policy document may contain only tab, line feed, carriage return and U+0020 to U+00FF (S3).
- **Names.** At most 128 characters; an inline policy name may not contain a backslash, slash, asterisk, question mark
  or space (S3).
- **Changes.** `aws_iam_policy` forces a new policy on a name or description change; the document itself updates in
  place (S1).
- **Building the document.** The provider recommends `jsonencode` or the `aws_iam_policy_document` data source over
  hand-written strings, which avoids formatting problems (S1, S2). Merging documents uses `source_policy_documents`
  (unique sids) and `override_policy_documents` (replaces matching sids) (S2); this is also how the single S3 bucket
  policy is composed ([resource-policy](../relations/resource-policy.md)).

## Placement

Global within an account.

## Relations

- [grant](../relations/grant.md): turns a connection from a role to a target into policy statements.
- [assume-role](../relations/assume-role.md): required managed policies per kind of role.

## Failure modes

| Situation | Result |
|---|---|
| Managed policy over 6,144 characters, inline total over 10,240 | Rejected (S3). Rule [VAL-108](../rules/validation.md) |
| More than 20 managed policies attached to one role | Rejected (S3). Rule [VAL-107](../rules/validation.md) |
| Statement without `Effect`, `Action` or `Resource` (identity policy) | Rejected (S2). Rule [VAL-117](../rules/validation.md) |
| Trust or resource policy statement without `Principal` | Rejected (S2). Rule [VAL-117](../rules/validation.md) |
| Inline policy name with a reserved character | Rejected (S3). Rule [VAL-120](../rules/validation.md) |
| Document with characters outside the allowed set | Rejected (S3) |
| Statements merged without unique sids | Cannot be overridden or errors (S2). Pitfall P-069 |
| `${...}` policy variable written as plain Terraform | Interpolated by Terraform, not AWS (S2). Pitfall P-065 |
| Allow `*` on `*` | Accepted by AWS, but defeats least privilege (S5). [SEC-036](../rules/security.md) |
| Account limit of customer managed policies reached | Rejected (S3). Rule [VAL-121](../rules/validation.md) |

## Limits, cost, security

See front matter. Security rules are in [rules/security.md](../rules/security.md): SEC-035 to SEC-042.

## Terraform mapping

`aws_iam_policy` (`name`, `description`, `policy`) attached with `aws_iam_role_policy_attachment`, or
`aws_iam_role_policy` (`name`, `role`, `policy`) for an inline policy. The `policy` value is
`data.aws_iam_policy_document.<x>.json` or `jsonencode(...)`. The platform generates statements from
[grant](../relations/grant.md) connections and from the managed policies a role kind requires
([assume-role](../relations/assume-role.md)); a raw JSON policy supplied by the user is an escape hatch checked by the
same rules (decision D-026).

## Sources

S1 to S6 in the front matter.

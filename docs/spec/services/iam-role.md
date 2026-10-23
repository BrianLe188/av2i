---
id: iam-role
title: { vi: "IAM Role (vai trò)", en: "IAM role and instance profile" }
terraform:
  resources: [aws_iam_role, aws_iam_role_policy, aws_iam_role_policy_attachment, aws_iam_instance_profile]
scope: global
placement: { requires: [], subnet_type: null, min_azs: null }
sources:
  S1: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/iam_role.html.markdown
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/iam_role_policy.html.markdown
  S3: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/iam_role_policy_attachment.html.markdown
  S4: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/iam_instance_profile.html.markdown
  S5: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html
  S6: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-service.html
  S7: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2_instance-profiles.html
  S8: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html
  S9: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html
  S10: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
scope_note: "Roles that an AWS service assumes on your behalf (EC2 instance profile, Lambda execution role, ECS task and task execution roles, RDS Enhanced Monitoring role), their permission policies, and instance profiles. IAM users, groups, access keys, federation (SAML, OIDC, Identity Center), IAM Roles Anywhere, cross-account roles, permissions boundaries, service control policies and service-linked roles are out of scope (decision D-024)"
properties:
  - key: name
    type: string
    required: true            # the provider generates one if omitted; the platform names roles
    force_new: true
    constraints:
      - "at most 64 characters"
      - "alphanumeric plus + = , . @ _ -"
      - "unique in the account and not distinguished by case (ADMINS and admins clash)"
      - "cannot be edited after creation because other entities may reference it"
      - "case-sensitive when used in a policy or ARN"
    src: [S1, S5, S6]
    status: verified
  - key: path
    type: string
    default: "/"
    constraints: ["begins and ends with a slash, at most 512 characters", "for the console switch-role feature the path and name together are at most 64 characters"]
    src: [S1, S5]
    status: verified
  - key: description
    type: string
    src: [S1]
    status: verified
  - key: assume_role_policy
    type: json
    required: true
    constraints:
      - "the trust policy: who may assume the role"
      - "give it as JSON (jsonencode or aws_iam_policy_document); it cannot reference an aws_iam_policy resource"
      - "at most 2,048 characters by default, 8,192 at most"
      - "for a service role the principal is the service, for example ec2.amazonaws.com, and the action sts:AssumeRole"
    src: [S1, S5, S6]
    status: verified
  - key: max_session_duration
    type: number
    default: 3600
    unit: seconds
    range: [3600, 43200]      # the provider says 1 to 12 hours; AWS role duration setting is 1 to 12 hours
    constraints: ["does not limit sessions assumed by AWS services"]
    src: [S1, S5]
    status: verified
  - key: permissions_boundary
    type: reference
    ref: iam-policy
    constraints: ["optional ARN of a managed policy that caps the role's permissions; out of the first version (D-024)"]
    src: [S1, S9]
    status: verified
  - key: force_detach_policies
    type: boolean
    default: false
    constraints: ["true detaches attached policies before destroying the role"]
    src: [S1]
    status: verified
  - key: tags
    type: map
    src: [S1]
    status: verified
instance_profile:
  - { key: name, type: string, force_new: true, constraints: ["at most 128 characters", "unique; reuse gives EntityAlreadyExists even if the role or path differ"], src: [S4, S5], status: verified }
  - { key: role, type: reference, ref: iam-role, required: true, constraints: ["one role per profile and the limit cannot be raised; a role can be in several profiles"], src: [S4, S7], status: verified }
  - { key: path, type: string, default: "/", src: [S4], status: verified }
permission_attachment:
  managed: { resource: aws_iam_role_policy_attachment, arguments: [role, policy_arn], constraints: ["at most 20 managed policies per role by default, 25 at most"], src: [S3, S5], status: verified }
  inline: { resource: aws_iam_role_policy, arguments: [name, role, policy], constraints: ["policy name at most 128 characters, no backslash, slash, asterisk, question mark or space, unique per role", "total of all inline policies on a role at most 10,240 characters, white space not counted"], src: [S2, S5], status: verified }
exported:
  - { key: arn, src: [S1] }
  - { key: name, src: [S1] }
  - { key: unique_id, src: [S1] }
limits:
  - { id: roles_per_account, value: 1000, adjustable: true, max: 10000, src: [S5], status: verified }
  - { id: managed_policies_per_role, value: 20, adjustable: true, max: 25, src: [S5], status: verified }
  - { id: instance_profiles_per_account, value: 1000, adjustable: true, max: 10000, src: [S5], status: verified }
  - { id: roles_per_instance_profile, value: 1, adjustable: false, src: [S5, S7], status: verified }
  - { id: role_trust_policy_length, value: 2048, adjustable: true, max: 8192, src: [S5], status: verified, note: "characters" }
  - { id: inline_policies_total_per_role, value: 10240, adjustable: false, src: [S5], status: verified, note: "characters, white space not counted" }
  - { id: role_name_length, value: 64, adjustable: false, src: [S5], status: verified }
  - { id: instance_profile_name_length, value: 128, adjustable: false, src: [S5], status: verified }
  - { id: policy_name_length, value: 128, adjustable: false, src: [S5], status: verified }
  - { id: role_session_duration, value: "1 to 12 hours", adjustable: false, src: [S5], status: verified }
  - { id: sts_requests, value: "600 per second per account per Region", adjustable: "by support case", src: [S5], status: verified, note: "requests made by AWS service principals do not use it" }
relations: [assume-role, grant]
cost: { model: free, notes: "IAM has no charge (unverified)" }
status: verified
---

# IAM role and instance profile

## Purpose

A role is an identity that has **permissions but no credentials of its own**. A workload "runs as" the role and AWS
gives it temporary credentials. This is how every compute service in this specification gets access to other
services, instead of long-lived access keys, which AWS advises against for workloads (S10). A role has two halves:

- the **trust policy** (`assume_role_policy`): who may become the role, here always an AWS service;
- the **permission policies**: what the role may then do.

## Behaviour

- **Trust is separate from permission.** A role with powerful permissions and no trust is unusable; a role with a
  trust and no permissions is usable but powerless. Both are needed (S1, S6).
- **Service roles.** A role that a service assumes on your behalf is a *service role*. The trust policy names the
  service principal and the action `sts:AssumeRole` (S6). A specialised service role owned by AWS is a
  *service-linked role* (created and managed by the service; out of scope) (S6).
- **EC2 is different:** a role reaches an instance through an **instance profile**, a container for one role.
  The console creates the profile for you with the same name as the role; Terraform and the API do not, so the
  profile is a separate resource (S4, S6, S7). One role per profile, a limit that cannot be raised; a role may be in
  several profiles (S5, S7).
- **Swapping the role of an instance** takes effect only after the change propagates (eventual consistency); AWS
  does not recommend removing a role from an instance profile because the change can take up to an hour. To update
  permissions, replace the instance profile; to force a swap, disassociate and associate the profile, or stop and
  start the instance (S7).
- **Names** cannot be changed after creation (S6) and are matched case-sensitively in ARNs and policies while being
  unique case-insensitively (S5, S6).
- **PassRole.** To give a role to a service (a Lambda function, an ECS task definition, an instance profile on an
  instance, an RDS monitoring role), the **identity that creates or updates that resource** needs `iam:PassRole` on
  the role. It works only inside one account, is a permission and not an API call (so CloudTrail shows nothing for it
  except the resource's own create call), and must be scoped to the roles intended, because a role with more power
  than the passer has would let the service act for them. Do not control it with the `ResourceTag` condition (S6,
  S8). The same principle covers who may create roles: a person who can create a role and attach any policy can
  escalate their own permissions (S6). The platform's deploying identity therefore needs scoped IAM permissions, which
  is part of what the platform should tell the user (decision D-028).
- **Evaluation.** Inside one account the permissions are the union of the identity-based policies (on the role) and
  resource-based policies (on the target); an allow in either is enough and an explicit deny in either wins. A
  permissions boundary or an organization policy only restricts (intersection). Across accounts both sides must allow
  (S9).
- **Temporary credentials.** Workloads should use the credentials a role provides; EC2 and Lambda deliver them
  automatically, ECS tasks through the container credential provider (S10 and [assume-role](../relations/assume-role.md)).
- **Management style.** The provider's inline `inline_policy` and `managed_policy_arns` arguments on the role are
  deprecated and take **exclusive** control of that kind of policy; they conflict with `aws_iam_role_policy` and
  `aws_iam_role_policy_attachment`, and an empty block removes policies made elsewhere (S1). The specification
  emits only the separate resources.

## Placement

Global within an account (IAM is not regional). Not in a VPC. Used by services in any Region of the account.

## Relations

- [assume-role](../relations/assume-role.md): which service runs as the role.
- [grant](../relations/grant.md): what the role may do on which target.
- [resource-policy](../relations/resource-policy.md): the other side of access, a policy on the target itself.

## Failure modes

| Situation | Result |
|---|---|
| Role name longer than 64 characters, or with other characters, or a case-insensitive duplicate | Rejected (S5). Rule [VAL-103](../rules/validation.md) |
| Trust policy missing the consumer's service principal | The service cannot assume the role. Rule [VAL-105](../rules/validation.md) |
| Trust policy over 2,048 characters | Rejected (S5). Rule [VAL-108](../rules/validation.md) |
| More than 20 managed policies on a role | Rejected (S5). Rule [VAL-107](../rules/validation.md) |
| Inline policies totalling over 10,240 characters | Rejected (S5). Rule [VAL-108](../rules/validation.md) |
| Two roles in one instance profile | Not possible (S5). Rule [VAL-109](../rules/validation.md) |
| Instance profile name reused | `EntityAlreadyExists` (S4). Rule [VAL-109](../rules/validation.md) |
| `inline_policy` or `managed_policy_arns` mixed with the separate resources | Permanent diffs, cycling (S1, S2, S3). Rule [VAL-118](../rules/validation.md) |
| `aws_iam_role_policy_attachment` together with `aws_iam_policy_attachment` for one role | Permanent diff (S3). Pitfall P-061 |
| Trust policy built from an `aws_iam_policy` resource | Not allowed (S1). Pitfall P-067 |
| Role passed to a service in another account | `PassRole` works only inside one account (S8). Rule [VAL-115](../rules/validation.md) |
| Role destroyed while policies are still attached through `aws_iam_policy_attachment` and the name or path changed | `DeleteConflict` unless `force_detach_policies` is true (S1). Pitfall P-062 |
| Newly created role used immediately | May not be visible yet because of eventual consistency (S7 for profiles; general for roles, `unverified`). Pitfall P-068 |

## Limits, cost, security

See front matter. Security: never attach `AdministratorAccess` ([SEC-035](../rules/security.md)), avoid
`Action "*"` on `Resource "*"` ([SEC-036](../rules/security.md)), do not trust `*`
([SEC-039](../rules/security.md)), scope trust of ECS roles with `aws:SourceAccount` and `aws:SourceArn`
([SEC-040](../rules/security.md)), give each workload its own role ([SEC-041](../rules/security.md)).

## Terraform mapping

`aws_iam_role` (`name`, `assume_role_policy`, `description`, `max_session_duration`, `tags`), one
`aws_iam_role_policy_attachment` (`role`, `policy_arn`) per managed policy, one `aws_iam_role_policy` (`name`, `role`,
`policy`) per inline policy, and, for EC2 only, `aws_iam_instance_profile` (`name`, `role`) referenced by
`aws_instance.iam_instance_profile` by **name** (S4 of [ec2](ec2.md)). Build every JSON document with `jsonencode` or
`aws_iam_policy_document` (S1, S2; see [iam-policy](iam-policy.md)). Never emit `aws_iam_policy_attachment`.

## Sources

S1 to S10 in the front matter.

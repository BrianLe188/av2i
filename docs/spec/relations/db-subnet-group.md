---
id: db-subnet-group
title: { vi: "Nhóm subnet của cơ sở dữ liệu", en: "DB subnet group" }
participants:
  - { role: database, service: rds }
  - { role: members, service: subnet }
direction: database->members
same_vpc: true
cardinality: { database: one, members: "2 to 20" }      # one group per instance; a group may serve many instances
user_drawn: true                                         # the user picks the subnets; the platform creates the group object
generates:
  - { terraform: "aws_db_subnet_group (name, subnet_ids)", on: group }
  - { terraform: "aws_db_instance.db_subnet_group_name", on: database }
conditions:
  - { text: { vi: "Ít nhất hai subnet ở hai Availability Zone khác nhau", en: "At least two subnets in two different Availability Zones" }, when: always }
  - { text: { vi: "Tất cả subnet cùng một VPC", en: "All subnets in one VPC" }, when: always }
  - { text: { vi: "Muốn truy cập công khai thì mọi subnet trong nhóm phải là subnet public", en: "For public access every subnet in the group must be public" }, when: "publicly_accessible is true" }
invalid_when: [VAL-058, VAL-062, VAL-067]
sources:
  S1: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/db_subnet_group.html.markdown
  S3: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html
status: verified          # items marked unverified in the cases below
---

# DB subnet group

## Meaning

A DB subnet group is the set of subnets RDS may use for an instance. RDS picks one subnet and one address from it
and the instance lives in that subnet's AZ (S1). It exists so that a standby can be placed in another AZ on
failover or conversion to Multi-AZ. On the canvas this is "the database lives in these subnets"; the platform
creates the group object.

## Cases

| # | Situation | Result |
|---|---|---|
| 1 | Two private subnets in two AZs | The normal case (S1) |
| 2 | One subnet only | Invalid. A subnet group needs at least two subnets in two AZs (S1). Rule [VAL-058](../rules/validation.md) |
| 3 | Two subnets in the same AZ | Invalid for the same reason. Rule [VAL-058](../rules/validation.md) |
| 4 | A subnet in every AZ of the Region | AWS's best practice, so a standby can go anywhere and a single-AZ instance can become Multi-AZ later (S1) |
| 5 | More than 20 subnets | Invalid; at most 20 per group (S3). Rule [VAL-058](../rules/validation.md) |
| 6 | Subnets from two VPCs | Invalid; a group belongs to one VPC (its `vpc_id` is exported, S2). Rule [VAL-058](../rules/validation.md) |
| 7 | All subnets private, `publicly_accessible` false | The standard private database (S1) |
| 8 | `publicly_accessible` true, all subnets public (internet-gateway route) | Reachable if the security group allows (S1) |
| 9 | `publicly_accessible` true, some or all subnets private | Not reachable from the internet. Rule [VAL-062](../rules/validation.md) |
| 10 | Mix of public and private subnets in one group | Allowed by AWS, but the instance's AZ is chosen by RDS, so exposure is not predictable. Avoid |
| 11 | Subnet CIDR too small | RDS needs a free address per instance in each subnet for recovery and scaling (S1). Too-small subnets fail during failover |
| 12 | Subnet changed from public to private while publicly accessible | Can affect the instance's availability (S1) |
| 13 | `multi_az` true | Needs the two-AZ group (S1). Rule [VAL-067](../rules/validation.md) |
| 14 | One group used by several instances | Allowed (the group is independent of the instance, S1) |
| 15 | Group `subnet_ids` changed | Not a replacement of the group (only `name` and `name_prefix` are, S2). Effect on a running instance's subnet is unverified |
| 16 | Group deleted while an instance uses it | Delete fails (unverified; general behaviour) |
| 17 | No group chosen | AWS and the provider fall back to a group named `default` (S1, S2 of [rds](../services/rds.md)); this platform requires an explicit group |
| 18 | VPC with dedicated tenancy | The instance class must be an approved dedicated class (S1). Rule [VAL-066](../rules/validation.md) |
| 19 | Local Zone, dual-stack, IPv6 | Out of scope (S1): Local Zone groups take one subnet; dual-stack needs IPv6 CIDRs on every subnet |

## Rules from the documentation

- Name: 1 to 255 characters, alphanumerics, spaces, hyphens, underscores, periods (S3). Changing it replaces the
  group (S2).
- Description defaults to "Managed by Terraform" (S2).
- 50 groups per Region by default (20 in ap-south-1) (S3).

## Failure modes

Creation fails if the subnets do not cover two AZs or are in different VPCs. A publicly accessible instance in
private subnets is created and then simply not reachable, which is the harder failure to notice, hence
[VAL-062](../rules/validation.md).

## Terraform mapping

```hcl
resource "aws_db_subnet_group" "main" {
  name       = "av2i-main"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}
resource "aws_db_instance" "main" {
  db_subnet_group_name = aws_db_subnet_group.main.name
  # ...
}
```

The shape is illustrative; the full argument list is in [rds](../services/rds.md) (S2).

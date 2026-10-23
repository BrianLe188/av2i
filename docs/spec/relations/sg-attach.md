---
id: sg-attach
title: { vi: "Gắn Security Group vào resource", en: "Security group attachment" }
participants:
  - { role: group, service: security-group }
  - { role: member, service: [ec2, ecs, rds, alb, lambda] }     # argument names per service are pending their own files
direction: undirected
same_vpc: true
cardinality: { group: many, member: many }                       # a group serves many resources; a resource has several groups
user_drawn: true
generates:
  - { terraform: "vpc_security_group_ids (EC2, Lambda vpc_config) / security_groups (ALB) / ...", on: member, status: unverified }
conditions:
  - { text: { vi: "Lambda chỉ có Security Group khi chạy trong VPC", en: "A Lambda function has security groups only when it runs in a VPC" }, when: "member is lambda", status: unverified }
  - { text: { vi: "Tối đa 5 Security Group cho mỗi network interface (mặc định)", en: "At most 5 security groups per network interface by default" }, when: "always" }
effects:
  - "group rules from all attached groups are merged into one set per resource"
invalid_when: [VAL-021, VAL-027, VAL-029]
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html
  S2: https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html
  S3: https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html
  S4: https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html
  S5: https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html
status: unverified          # general behaviour verified; per-service arguments pending
---

# Security group attachment

## Meaning

A resource's network interface is guarded by the security groups attached to it. The attachment is what makes a
group's rules apply.

## Cases

| # | Situation | Result |
|---|---|---|
| 1 | One explicit group | Its rules apply |
| 2 | Several explicit groups | Rules are merged; any allow rule in any group allows the traffic (S2) |
| 3 | No group chosen | AWS would use the VPC's `default` group (S3), which allows all traffic between its members and all outbound traffic. **This platform treats it as an error** (D-005, rule [VAL-029](../rules/validation.md)) |
| 4 | Explicit groups plus the default group | Allowed; the default group stays in force if attached |
| 5 | More than 5 groups on one interface | Invalid at the default quota; adjustable up to 16, and groups times rules per group cannot exceed 1000 (S4). [VAL-021](../rules/validation.md) |
| 6 | Group from another VPC | Invalid (VPC association across VPCs is out of scope). [VAL-027](../rules/validation.md) |
| 7 | Attaching to a NAT gateway or internet gateway | Not possible; they take no group (S5) |
| 8 | Resource with several interfaces (EC2, Lambda, ECS) | Each interface has its own groups. Details per service |

## Rules

- A group can be used only by resources in its own VPC unless VPC association is used (S1).
- A group that is attached cannot be deleted (S1 of [security-group](../services/security-group.md)).
- A resource must name at least one explicit group; the default group is never used implicitly (decision D-005,
  decided).

## Failure modes

Group in the wrong VPC: `InvalidParameter` style error at apply (unverified). Replacing a group that is in use:
see the "Security Group Deletion Problem" in [terraform/pitfalls.md](../terraform/pitfalls.md).

## Terraform mapping

Per service. The argument name differs.

| Member | Argument | Status |
|---|---|---|
| ec2 | `vpc_security_group_ids` on `aws_instance` (not `security_groups`, which is for EC2-Classic and the default VPC) | verified |
| lambda | `vpc_config.security_group_ids` on `aws_lambda_function`, together with `subnet_ids` | verified |
| ecs | `network_configuration.security_groups` on `aws_ecs_service`, with `subnets`; 1 to 5 groups | verified |
| alb | `security_groups` on `aws_lb` (application and network load balancers only) | verified |
| rds | `vpc_security_group_ids` on `aws_db_instance` | verified |

Two provider defaults conflict with decision D-005 and must be overridden: `aws_ecs_service` uses the VPC default
group when `security_groups` is omitted, and AWS gives any resource without a group the default group.
The platform always emits the explicit list. Rule [VAL-029](../rules/validation.md) enforces that the list is
not empty.

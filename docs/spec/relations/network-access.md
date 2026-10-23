---
id: network-access
title: { vi: "Quyền truy cập mạng giữa các workload", en: "Network access between workloads" }
participants:
  - { role: caller, service: [ec2, ecs, lambda, alb] }
  - { role: callee, service: [ec2, ecs, rds] }       # rds and alb written; an ALB is a caller of targets, see listener-target
direction: caller->callee
same_vpc: true
cardinality: { caller: many, callee: many }
user_drawn: true
derived: true                      # the connection is the cause; security group rules are the effect
properties:
  port: { source: "callee's service port: database engine port, ECS container port, EC2 listener port", editable: true }
  protocol: { default: tcp }
generates:
  - { rule: "ingress on a callee group", peer: "a caller group", via: sg-reference, terraform: "aws_vpc_security_group_ingress_rule.referenced_security_group_id" }
  - { rule: "egress on a caller group", when: "the caller group restricts outbound traffic", via: sg-reference, terraform: "aws_vpc_security_group_egress_rule.referenced_security_group_id" }
conditions:
  - { text: { vi: "Caller và callee phải cùng VPC", en: "Caller and callee must be in the same VPC" }, when: always }
  - { text: { vi: "Mỗi bên phải có ít nhất một Security Group tường minh (D-005)", en: "Each side needs at least one explicit security group (D-005)" }, when: always }
  - { text: { vi: "Lambda phải gắn VPC mới gọi được tài nguyên riêng tư", en: "A Lambda function must be attached to the VPC to reach private resources" }, when: "caller is lambda" }
invalid_when: [VAL-025, VAL-029, VAL-049, VAL-068]
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html
  S2: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html
  S3: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html
  S4: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html
  S5: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/ecs_service.html.markdown
status: unverified          # the mechanism is built from verified security group behaviour; the choice of which group carries the rule is a platform decision (D-012)
---

# Network access between workloads

## Meaning

The user draws "A may call B". AWS has no such object: what exists is security group rules. This mechanism is the
translation. Drawing A to B means: B's security group allows the port from A's security group.

```
caller group  --(egress, only if it restricts outbound)-->  callee group
callee group  <--(ingress: port, source = caller group)---  caller group
```

Because security groups are stateful, replies need no extra rule (S2).

## Which group carries the rule

A resource may have several explicit groups (up to 5 per interface, S2). Decision D-012 (open) proposes:

1. If the resource has exactly one group, use it.
2. If several, the connection must name one on each side; otherwise it is an error.
3. The rule is never added to the VPC default group.

## Cases

| # | Caller | Callee | Port | Notes |
|---|---|---|---|---|
| 1 | EC2, ECS task or Lambda (attached to the VPC) | RDS | the instance `port`, else the engine default (5432 PostgreSQL, 3306 MySQL: unverified) | The common case. Ingress on the database group, source the caller group. Rule [VAL-068](../rules/validation.md) |
| 2 | Lambda **not** attached to a VPC | RDS in a private subnet | | Not reachable. The function must be attached (S3). Rule [VAL-049](../rules/validation.md) |
| 3 | ALB | ECS service | container port, plus the health check port if it differs | Ingress on the service's group, source the ALB's group. Target group type must be `ip` for Fargate (S4). The ALB's own group must allow the listener ports inbound and the target and health check ports outbound ([alb](../services/alb.md), rule [VAL-082](../rules/validation.md)) |
| 4 | ALB | EC2 | instance port | Same, target type `instance` or `ip` |
| 5 | EC2 | EC2 | any | Ingress on the callee group; or both instances share one group with a self-referencing rule |
| 6 | ECS service | ECS service | container port | Each service's tasks carry the service's groups (S5) |
| 7 | Caller and callee share one group | | | One self-referencing ingress rule is enough. The default group does this by default (S1), but it is not used here (D-005) |
| 8 | Caller group restricts egress | | | An egress rule to the callee group is also needed |
| 9 | Caller group allows all egress (the common choice) | | | No egress rule needed |
| 10 | Caller and callee in different VPCs | | | Invalid here; needs peering or a transit gateway (S1). [VAL-025](../rules/validation.md) |
| 11 | Two connections that produce the same rule | | | Emit one rule. [VAL-026](../rules/validation.md) |
| 12 | Connection removed | | | The rule it created must be removed; rules the user wrote by hand stay |
| 13 | Callee has no explicit group | | | Error [VAL-029](../rules/validation.md) |
| 14 | Traffic through a middlebox between two instances | | | A group reference does not allow it; reference the address or CIDR instead (S1) |

## Failure modes

The connection looks valid on the canvas but traffic is blocked when: the callee group lacks the ingress rule,
the caller group restricts egress and lacks the egress rule, the port is wrong, or a Lambda caller is not
attached to the VPC. Each is a design-time check, not a runtime surprise.

## Terraform mapping

`aws_vpc_security_group_ingress_rule` with `security_group_id` = callee group, `referenced_security_group_id` =
caller group, `ip_protocol`, `from_port`, `to_port`; and, when needed, the matching
`aws_vpc_security_group_egress_rule` (see [sg-reference](sg-reference.md)).

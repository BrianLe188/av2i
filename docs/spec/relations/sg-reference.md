---
id: sg-reference
title: { vi: "Rule tham chiếu Security Group khác", en: "Security group reference" }
participants:
  - { role: owner, service: security-group }
  - { role: peer, service: security-group }
direction: owner->peer          # the owner's rule names the peer as source (ingress) or destination (egress)
same_vpc: true                  # peering and transit gateway cases are out of scope
cardinality: { owner: many, peer: many }
user_drawn: true
generates:
  - { terraform: "referenced_security_group_id", on: "aws_vpc_security_group_ingress_rule / aws_vpc_security_group_egress_rule" }
effects:
  - "no rules of the peer are copied into the owner"
  - "traffic is allowed between the private addresses of the interfaces that carry the groups"
invalid_when: [VAL-023, VAL-025, VAL-026]
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/vpc_security_group_ingress_rule.html.markdown
  S3: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/security_group.html.markdown
  S4: https://docs.aws.amazon.com/vpc/latest/userguide/deleting-security-groups.html
status: verified          # VAL-026 is unverified
---

# Security group reference

## Meaning

A rule can name another security group as its source or destination instead of an address range. It then covers
every resource that carries that group. This is how tiers are expressed: the database group allows the database
port from the application group; the application group allows traffic from the load balancer group.

## Cases

| # | Situation | Result |
|---|---|---|
| 1 | Ingress rule on B, peer A, same VPC | Resources with A may reach resources with B on the port (S1) |
| 2 | Egress rule on A, peer B, same VPC | Resources with A may send to resources with B on the port. Needs the matching ingress on B only when B restricts inbound |
| 3 | Rule referencing its own group (self) | Members talk to each other. The default group does this by default (S1) |
| 4 | Peer group in a different VPC | Invalid unless VPCs are peered or joined by a transit gateway (ingress), or peered (egress) (S1). Out of scope. [VAL-025](../rules/validation.md) |
| 5 | Peer group deleted | The rule must go too; the peer cannot be deleted while a rule references it (S4) |
| 6 | Peer group referenced by many rules | Counts as one rule each time, regardless of the peer's size (S1) |
| 7 | Traffic through a middlebox appliance between instances | A group reference does not allow it; reference the private address or the subnet CIDR instead (S1) |
| 8 | Rule with a group and also an address range | Invalid: exactly one peer per rule (S2). [VAL-023](../rules/validation.md) |
| 9 | Two identical rules | Duplicate. [VAL-026](../rules/validation.md) |

## Failure modes

- Creation order: the peer group must exist before the rule that references it, so Terraform must reference it
  by attribute and not by name. Two groups that reference each other work because the rules are separate
  resources, which is a reason to emit rules separately and never inline (S2, S3).
- AWS does not authorise against the referenced group when creating the rule, only checks it exists (S1).

## Terraform mapping

`aws_vpc_security_group_ingress_rule` or `aws_vpc_security_group_egress_rule` with
`referenced_security_group_id = aws_security_group.<peer>.id`, `ip_protocol` and ports (S2).

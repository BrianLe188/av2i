---
id: security-group
title: { vi: "Security Group (nhóm bảo mật)", en: "Security group" }
terraform:
  resources: [aws_security_group, aws_vpc_security_group_ingress_rule, aws_vpc_security_group_egress_rule]
scope: vpc
placement: { requires: [vpc], subnet_type: null, min_azs: null }
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html
  S2: https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html
  S3: https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html
  S4: https://docs.aws.amazon.com/vpc/latest/userguide/deleting-security-groups.html
  S5: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/security_group.html.markdown
  S6: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/vpc_security_group_ingress_rule.html.markdown
  S7: https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html
properties:
  - key: name
    type: string
    required: false
    constraints:
      - "unique within the VPC, not case-sensitive"
      - "up to 255 characters"
      - "characters: a-z A-Z 0-9 space . _ - : / ( ) # , @ [ ] + = & ; { } ! $ *"
      - "must not start with sg-"
      - "trailing spaces are trimmed"
    force_new: true
    src: [S1, S5]
    status: verified
  - key: description
    type: string
    required: true            # provider default is "Managed by Terraform"; it cannot be empty
    constraints: ["same length and character limits as name", "cannot be empty", "no update API"]
    force_new: true
    src: [S1, S5]
    status: verified
  - key: vpc_id
    type: reference
    ref: vpc
    force_new: true
    src: [S5]
    status: verified
  - key: ingress_rules
    type: list
    item:
      protocol: { enum: [tcp, udp, icmp, icmpv6, all, "number"] }
      ports: "from_port and to_port; for icmp they are type and code; omitted for all protocols (-1)"
      peer: { one_of: [cidr_ipv4, cidr_ipv6, prefix_list_id, referenced_security_group_id] }
      description: "up to 255 characters, same character set as names"
    constraints: ["exactly one peer per rule", "a rule has one port range; several ranges need several rules"]
    src: [S2, S6]
    status: verified
  - key: egress_rules
    type: list
    item: "same shape as ingress; peer means destination"
    constraints: ["a new security group created in AWS has one allow-all outbound rule, but Terraform removes it on creation (see Terraform mapping)"]
    src: [S2, S5]
    status: verified
  - key: tags
    type: map
    src: [S5]
    status: verified
limits:
  - { id: security_groups_per_region, value: 2500, adjustable: true, src: [S7], status: verified }
  - { id: rules_per_direction_per_family, value: 60, adjustable: true, src: [S7], status: verified, note: "inbound and outbound counted separately; IPv4 and IPv6 counted separately" }
  - { id: security_groups_per_network_interface, value: 5, adjustable: true, max: 16, src: [S7], status: verified, note: "this times rules per group cannot exceed 1000" }
  - { id: rules_x_groups_product, value: 1000, adjustable: false, src: [S7], status: verified }
  - { id: name_and_description_length, value: 255, adjustable: false, src: [S1], status: verified }
relations: [containment, sg-attach, sg-reference]
cost: { model: free, notes: "" }
status: verified
---

# Security group

## Purpose

A virtual firewall for the network interface of a resource. It decides which traffic may reach a resource and
which may leave it. It is the main way to restrict access between tiers (load balancer, application,
database).

## Behaviour

- **Allow rules only.** There is no deny rule (S2).
- **Stateful.** A reply to allowed traffic is allowed regardless of the opposite direction's rules (S1).
- **No traffic is allowed in until a rule allows it.** A new group has no inbound rules (S2).
- **Outbound:** in AWS a new group has one allow-all outbound rule. If every outbound rule is removed, no
  outbound traffic is allowed (S2). Terraform deletes that default rule when it creates the group, so the
  design must state its outbound rules explicitly (S5).
- **Several groups on one resource are merged:** all their rules together form one set (S2).
- **Rule changes apply immediately** to every resource using the group (S2).
- **Peer types:** an IPv4 or IPv6 CIDR (a single address needs `/32` or `/128`), a managed prefix list, or
  another security group (S2). A rule that references a group does not copy that group's rules (S2).
- **Referencing a group:** in an inbound rule the referenced group must be in the same VPC, or the VPCs must be
  peered or joined through a transit gateway. In an outbound rule, same VPC or peering (S2). In a three-tier
  design this lets the database accept traffic from "the app group" without knowing addresses.
- **Default group:** every VPC has a group named `default` that allows all traffic between its members and all
  outbound traffic. It cannot be deleted. Its rules can be changed. A resource with no group chosen gets it
  (S3).
- **Not filtered by security groups:** DNS to the Route 53 Resolver, DHCP, instance metadata, ECS task
  metadata, Windows license activation, Amazon Time Sync, and reserved router addresses (S1, S2).
- Rule sizing: a CIDR or group reference counts as one rule; a customer-managed prefix list counts as its
  maximum size; an AWS-managed prefix list counts as its weight (S2).

## Placement

VPC level, not in a subnet. Used by resources in the same VPC (or other VPCs through VPC association, which is
out of scope). A NAT gateway and an internet gateway cannot have one (see [nat-gateway](nat-gateway.md)).

## Relations

- [sg-attach](../relations/sg-attach.md): which resources use it.
- [sg-reference](../relations/sg-reference.md): rules that name another group as peer.

## Failure modes

| Situation | Result |
|---|---|
| Name starts with `sg-`, or has a character outside the allowed set, or exceeds 255 | AWS rejects it (S1) |
| Two groups with the same name in one VPC (case-insensitive) | AWS rejects the second (S1) |
| Empty description | Provider rejects it (S5) |
| Changing `name`, `description` or `vpc_id` | Group is replaced (S5) |
| Deleting a group that is attached, referenced by another group's rule, or is the default | Delete fails (S3, S4) |
| Inline `ingress`/`egress` mixed with `aws_vpc_security_group_*_rule` or `aws_security_group_rule` | Perpetual diffs, rules overwritten (S5, S6) |
| Removing inline blocks | The rules are not removed; set `ingress = []` and `egress = []` (S5) |
| A rule with neither `cidr_blocks` nor `ipv6_cidr_blocks` (inline form) | Blocks all traffic (S5) |
| Rule count above 60 per direction and family, or groups on an interface above 5 | AWS rejects it (S7) |
| Duplicate rule in one group | AWS rejects it (unverified) |
| Replacing a group in use | The "Security Group Deletion Problem": the old one cannot be deleted while attached. See `terraform/pitfalls.md` |

## Limits, cost, security

See front matter. No cost. Security guidance from AWS: create the fewest groups that do the job, restrict SSH
(22) and RDP (3389) to known ranges, and do not open large port ranges (S1). Rules
[SEC-001 to SEC-005](../rules/security.md).

## Terraform mapping

`aws_security_group` with `name`, `description`, `vpc_id` and **no inline rules**, then one
`aws_vpc_security_group_ingress_rule` or `..._egress_rule` per rule. The provider recommends this form and
warns against mixing with inline rules or `aws_security_group_rule` (S5, S6). Each rule resource takes one peer
argument (`cidr_ipv4`, `cidr_ipv6`, `prefix_list_id` or `referenced_security_group_id`) and `ip_protocol`;
`from_port`/`to_port` are required unless `ip_protocol` is `-1` or `icmpv6`, and must not be set for `-1`.
Because the provider removes AWS's default allow-all egress, emit egress rules explicitly (S5, S6).

## Sources

S1 to S7 in the front matter.

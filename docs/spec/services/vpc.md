---
id: vpc
title: { vi: "VPC (mạng riêng ảo)", en: "Virtual Private Cloud (VPC)" }
terraform:
  resources: [aws_vpc, aws_default_security_group]
scope: regional
placement: { requires: [], subnet_type: null, min_azs: null }
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/vpc.html.markdown
  S3: https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html
  S4: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html
  S5: https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html
  S6: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/default_security_group.html.markdown
properties:
  - key: cidr_block
    type: string
    required: true            # platform choice; the provider marks it optional because IPAM can supply it
    default: null
    constraints:
      - "IPv4 CIDR, netmask between /16 and /28"
      - "must not be 0.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16 or 224.0.0.0/4"
      - "RFC 1918 ranges recommended (10/8, 172.16/12, 192.168/16)"
      - "avoid 172.17.0.0/16 because some AWS services use it"
      - "AWS normalises to canonical form (100.68.0.18/18 becomes 100.68.0.0/18)"
    force_new: unverified     # the provider page does not say; an existing CIDR cannot be resized (S1)
    src: [S1, S2]
    status: verified
  - key: enable_dns_support
    type: boolean
    default: true
    constraints: []
    src: [S2]
    status: verified
  - key: enable_dns_hostnames
    type: boolean
    default: false
    constraints: ["requires enable_dns_support = true to resolve names (unverified)"]
    src: [S2]
    status: verified          # default verified; the dependency on dns_support is unverified
  - key: instance_tenancy
    type: enum
    values: [default, dedicated]
    default: default
    constraints: ["dedicated adds a per-region hourly fee plus a per-instance fee"]
    src: [S2]
    status: verified
  - key: assign_generated_ipv6_cidr_block
    type: boolean
    default: false
    constraints: ["Amazon-provided /56, range not selectable", "conflicts with ipv6_ipam_pool_id"]
    src: [S2]
    status: verified
    scope_note: "IPv6 is out of the first version; listed so the model does not forbid it later"
  - key: tags
    type: map
    default: null
    src: [S2]
    status: verified
exported:
  - { key: id, src: [S2] }
  - { key: arn, src: [S2] }
  - { key: cidr_block, src: [S2] }
  - { key: main_route_table_id, src: [S2] }
  - { key: default_route_table_id, src: [S2] }
  - { key: default_security_group_id, src: [S2] }
  - { key: default_network_acl_id, src: [S2] }
  - key: default_security_group
    type: object
    value: managed, no rules
    constraints:
      - "emitted as an aws_default_security_group with vpc_id and no ingress or egress blocks; Terraform adopts the group and removes every rule at once (S6)"
      - "its rules are inline and absolute, so no aws_security_group_rule or rule resource may target it (S6, decision D-005 already forbids using it)"
      - "removing the resource from the design leaves the rules as they are; it does not restore the defaults (S6)"
      - "changing vpc_id forces a new resource and does not restore rules (S6)"
    src: [S5, S6]
    status: verified
limits:
  - { id: vpcs_per_region, value: 5, adjustable: true, src: [S3], status: verified, note: "raising it raises internet gateways per Region by the same amount" }
  - { id: subnets_per_vpc, value: 200, adjustable: true, src: [S3], status: verified }
  - { id: ipv4_cidr_blocks_per_vpc, value: 5, adjustable: true, max: 50, src: [S3], status: verified, note: "primary plus secondary" }
  - { id: route_tables_per_vpc, value: 200, adjustable: true, src: [S3], status: verified, note: "the main route table counts" }
  - { id: network_address_usage, value: 64000, adjustable: true, max: 256000, src: [S3], status: verified }
relations: [containment, igw-attach]
cost: { model: free, notes: "dedicated tenancy adds fees (S2)" }
status: verified
---

# VPC

## Purpose

A VPC is a logically isolated network in one region. Every resource in this specification that has a network
interface lives in one. Use one VPC per environment or workload boundary. Do not use the account's default VPC
for designed infrastructure: it ships with an internet gateway and public subnets that the user did not draw.

## Behaviour

- A VPC has one primary IPv4 CIDR block. Secondary CIDR blocks can be added later; the primary cannot be
  removed and an existing block cannot be resized (S1).
- Creating a VPC also creates, without being asked: a **main route table** (local route only), a **default
  security group** and a **default network ACL** (S2, S4, S5). They exist even when the design draws none.
- The main route table is the one a subnet uses when it has no explicit association (see
  [route-association](../relations/route-association.md)).
- The default security group allows all inbound traffic from members of itself and all outbound traffic. It
  cannot be deleted, but its rules can be edited (S5). A resource created without a security group gets this
  group.
- A VPC is private by default. Internet access needs an internet gateway, a route to it and a public address
  (see [igw-attach](../relations/igw-attach.md)).
- Terraform's `enable_dns_support` defaults to `true` and `enable_dns_hostnames` to `false` (S2).

## Placement

Regional. Not inside anything. Contains subnets, route tables, security groups, an internet gateway and NAT
gateways (see [containment](../relations/containment.md)).

## Relations

- [containment](../relations/containment.md): parent of subnets and of the VPC-level resources.
- [igw-attach](../relations/igw-attach.md): at most one internet gateway at a time.

## Failure modes

| Situation | Result |
|---|---|
| CIDR outside /16 to /28 | AWS rejects the request (S1) |
| CIDR is one of the blocked ranges | AWS rejects the request (S1) |
| Secondary CIDR overlaps an existing one, or the VPC is at its CIDR quota | AWS rejects the association (S1, S3) |
| Two VPCs with overlapping CIDRs are later peered or joined through Direct Connect gateway | Not possible; plan non-overlapping ranges from the start (S1) |
| GuardDuty created endpoints or security groups tagged `GuardDutyManaged=true` inside the VPC | The provider removes them on destroy if they block deletion, and warns if it cannot (S2) |

## Limits, cost, security

Limits are in the front matter. A VPC costs nothing by itself. Security: the default security group and default
network ACL are open; see rules [SEC-004](../rules/security.md).

## Terraform mapping

`aws_vpc` with `cidr_block`, `enable_dns_support`, `enable_dns_hostnames`, `instance_tenancy`, `tags`.
Reference `aws_vpc.<x>.id` from every dependent resource. Do not set both `assign_generated_ipv6_cidr_block`
and `ipv6_ipam_pool_id` (conflict), nor `ipv4_netmask_length` without `ipv4_ipam_pool_id` (S2).

## Sources

S1 to S5 in the front matter.

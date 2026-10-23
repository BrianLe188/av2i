---
id: subnet
title: { vi: "Subnet (mạng con)", en: "Subnet" }
terraform:
  resources: [aws_subnet]
scope: az
placement: { requires: [vpc], subnet_type: null, min_azs: null }
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/subnet.html.markdown
  S3: https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html
  S4: https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html
  S5: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html
properties:
  - key: vpc_id
    type: reference
    ref: vpc
    required: true
    force_new: unverified
    src: [S2]
    status: verified
  - key: cidr_block
    type: string
    required: true            # platform choice; the provider allows IPAM instead
    constraints:
      - "IPv4 CIDR, netmask between /28 and /16"
      - "inside one of the VPC's CIDR blocks"
      - "must not overlap another subnet of the VPC"
      - "first four and last address are reserved, so a /28 holds 11 usable addresses"
    force_new: unverified
    src: [S1, S2]
    status: verified
  - key: availability_zone
    type: string
    required: false
    constraints: ["exactly one of availability_zone or availability_zone_id; if neither is set AWS chooses"]
    force_new: unverified
    src: [S2]
    status: verified
  - key: map_public_ip_on_launch
    type: boolean
    default: false
    constraints: ["does not make a subnet public; routing does (see relations/route-association)"]
    src: [S2, S4]
    status: verified
  - key: tags
    type: map
    src: [S2]
    status: verified
limits:
  - { id: subnets_per_vpc, value: 200, adjustable: true, src: [S3], status: verified }
  - { id: reserved_addresses_ipv4, value: 5, adjustable: false, src: [S1], status: verified, note: "network, router (.1), DNS (.2), future use (.3), broadcast (last)" }
relations: [containment, route-association, nat-placement, db-subnet-group]
cost: { model: free, notes: "" }
status: verified
---

# Subnet

## Purpose

A subnet is a range of IP addresses inside a VPC, in exactly one Availability Zone. Resources with network
interfaces are placed in subnets. Subnets are how a design expresses **availability** (spread across AZs) and
**exposure** (public or private).

## Behaviour

- A subnet belongs to one VPC and one AZ. The AZ is fixed by where the subnet is created (S2).
- Its CIDR must lie inside the VPC's CIDR and must not overlap another subnet (S1).
- AWS reserves five addresses in each IPv4 subnet (S1). Size subnets with that in mind: a `/28` leaves 11.
- **A subnet is public or private only because of its route table.** If its route table has a route to an
  internet gateway it is public; otherwise it is private (S4). `map_public_ip_on_launch` only decides whether
  new instances get a public IPv4 address. A subnet with that flag on but no internet-gateway route is still
  private (S4).
- Every subnet has exactly one route table. With no explicit association it uses the VPC's main route table
  (S5).
- Lambda network interfaces can keep a subnet busy after the function is gone; the provider waits up to 45
  minutes when deleting such a subnet (S2).

## Placement

Inside a VPC, in one AZ. Hosts: [nat-gateway](nat-gateway.md) (zonal), EC2, ECS tasks, Lambda interfaces, RDS
instances, ALB nodes. Which of those need a public or private subnet, and how many AZs, is stated in each of
their files.

## Relations

- [containment](../relations/containment.md): child of a VPC, parent of placed resources.
- [route-association](../relations/route-association.md): chooses the route table, which decides public or
  private.
- [nat-placement](../relations/nat-placement.md): a zonal public NAT gateway sits in a public subnet.
- [db-subnet-group](../relations/db-subnet-group.md): RDS needs subnets in at least two AZs.

## Failure modes

| Situation | Result |
|---|---|
| CIDR outside the VPC range, overlapping another subnet, or netmask outside /28 to /16 | AWS rejects creation (S1) |
| No AZ given | AWS picks one; the design is no longer deterministic. Rule [VAL-006](../rules/validation.md) |
| `ipv4_netmask_length` without `ipv4_ipam_pool_id` | Provider error (S2) |
| Deleting a subnet while network interfaces remain in it | Delete fails until they are gone; Lambda may take up to 45 minutes (S2) |

## Limits, cost, security

200 subnets per VPC (adjustable). No cost. Security: a public subnet is only as exposed as its security groups
allow; see [security-group](security-group.md).

## Terraform mapping

`aws_subnet` with `vpc_id`, `cidr_block`, `availability_zone`, `map_public_ip_on_launch`. For a secondary VPC
CIDR, reference the `vpc_id` of the `aws_vpc_ipv4_cidr_block_association` so ordering is correct (S2).

## Sources

S1 to S5 in the front matter.

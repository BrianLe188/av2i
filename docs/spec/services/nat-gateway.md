---
id: nat-gateway
title: { vi: "NAT Gateway", en: "NAT gateway" }
terraform:
  resources: [aws_nat_gateway]
scope: az                      # zonal mode; regional mode is VPC level (see decisions D-002)
placement:
  requires: [vpc, subnet]      # zonal mode needs a subnet; regional mode needs only the VPC
  subnet_type: public          # zonal public NAT gateway
  min_azs: null
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html
  S2: https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html
  S3: https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateways-regional.html
  S4: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/nat_gateway.html.markdown
  S5: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/eip.html.markdown
  S6: https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html
properties:
  - key: availability_mode
    type: enum
    values: [zonal, regional]
    default: zonal
    constraints: ["regional requires connectivity_type = public", "regional takes vpc_id and no subnet_id or allocation_id"]
    src: [S3, S4]
    status: verified
  - key: connectivity_type
    type: enum
    values: [public, private]
    default: public
    constraints: ["private has no Elastic IP", "a private gateway routed to an internet gateway has its traffic dropped"]
    src: [S1, S4]
    status: verified
  - key: subnet_id
    type: reference
    ref: subnet
    required: "zonal only"
    constraints: ["public zonal gateway: a public subnet", "must not be set for regional"]
    src: [S1, S4]
    status: verified
  - key: allocation_id
    type: reference
    ref: elastic-ip
    required: "public zonal only"
    constraints: ["associated at creation, cannot be added later for a public gateway (S1)", "must not be set for regional"]
    src: [S1, S4]
    status: verified
  - key: vpc_id
    type: reference
    ref: vpc
    required: "regional only"
    src: [S4]
    status: verified
  - key: tags
    type: map
    src: [S4]
    status: verified
limits:
  - { id: nat_gateways_per_az, value: 5, adjustable: true, src: [S6], status: verified, note: "counts pending, active and deleting" }
  - { id: eips_per_public_nat_gateway, value: 2, adjustable: true, max: 8, src: [S2, S6], status: verified }
  - { id: eips_per_region, value: 5, adjustable: true, src: [S6], status: verified, note: "shared with every other Elastic IP in the Region" }
  - { id: bandwidth, value: "5 Gbps, scales to 100 Gbps", adjustable: false, src: [S2], status: verified }
  - { id: packets_per_second, value: "1 million, scales to 10 million", adjustable: false, src: [S2], status: verified }
  - { id: connections_per_ip_per_destination, value: 55000, adjustable: false, src: [S2], status: verified, note: "more IPs raise it" }
  - { id: regional_ips_per_az, value: 32, adjustable: false, src: [S3], status: verified }
relations: [containment, nat-placement, eip-attach, route]
cost: { model: hourly, notes: "hourly plus per-GB processing (unverified; see pricing page). Public IPv4 addresses are billed (unverified)" }
status: verified
---

# NAT gateway

## Purpose

Lets resources in **private** subnets start connections to the internet (or to other networks) while receiving
no unsolicited inbound connections (S1). Use it when private workloads need to reach the internet, for example
to pull packages, call external APIs, or reach AWS public endpoints without a VPC endpoint. Do not use it for
inbound traffic: that is what a load balancer or a public address is for.

## Behaviour

- **Public, zonal (default).** Created in one public subnet, with an Elastic IP given at creation. Private
  subnets send `0.0.0.0/0` to it; it sends that traffic on to the internet gateway, which maps it to the
  Elastic IP (S1). The subnet that hosts the NAT gateway therefore needs its own route to the internet
  gateway (S3).
- **Private.** No Elastic IP. Used to reach other VPCs or on-premises networks through a transit or virtual
  private gateway. Traffic sent to an internet gateway is dropped (S1).
- **Regional.** One gateway for the whole VPC that expands to the AZs that hold network interfaces. No public
  subnet is needed, AWS creates a route table for it with a route to the internet gateway, and it can take up
  to 60 minutes to cover a new AZ. It does not support private NAT (S3, S4).
- A zonal gateway lives in one AZ. If that AZ fails, every subnet routed to it loses outbound access. For
  resilience, create one per AZ and route each private subnet to the gateway in its own AZ (S2).
- Connections must start inside the VPC (S1). Protocols: TCP, UDP, ICMP (S2).
- It cannot have a security group. Control traffic with the security groups of the instances and with network
  ACLs on its subnet (S2).
- It cannot be reached through a VPC peering connection, nor through a virtual private gateway (S2).

## Placement

Zonal: a public subnet of the VPC, in the AZ it should serve. Regional: the VPC only.

## Relations

- [nat-placement](../relations/nat-placement.md): subnet and the internet gateway dependency.
- [eip-attach](../relations/eip-attach.md): the [elastic-ip](elastic-ip.md) of a public zonal gateway (decision D-007).
- [route](../relations/route.md): private route tables target it.

## Failure modes

| Situation | Result |
|---|---|
| Zonal public gateway in a subnet with no route to an internet gateway | Created, but no traffic reaches the internet. Rule [VAL-012](../rules/validation.md) |
| Private subnet routed to a gateway in another AZ | Works, but adds cross-AZ cost and depends on that AZ. Rule [VAL-013](../rules/validation.md) |
| One gateway shared by several AZs | AZ outage cuts the others off (S2) |
| Elastic IP quota (5 per Region) exhausted by several gateways | Allocation fails. One zonal public gateway uses one EIP, so a design with many gateways can hit it quickly |
| Attaching an EIP to a NAT gateway through `network_interface` | `AuthFailure`; use `allocation_id` (S5) |
| Combining `secondary_allocation_ids` with `aws_nat_gateway_eip_association` | Perpetual diffs (S4) |
| Moving an allocation between AZs of a regional gateway in one apply | Not supported; remove, apply, then add (S4) |

## Limits, cost, security

See front matter. Cost is hourly plus data processing, so a NAT gateway per AZ is a deliberate cost decision
(unverified, confirm on the pricing page). Security: outbound only, but everything in the private subnet can
reach anywhere on the internet through it; restrict with security group egress rules.

## Terraform mapping

Zonal public: an [elastic-ip](elastic-ip.md) (`aws_eip` with `domain = "vpc"`), then `aws_nat_gateway` with `allocation_id`, `subnet_id`,
`connectivity_type = "public"` and `depends_on = [aws_internet_gateway.<x>]` (S4, S5). Regional:
`aws_nat_gateway` with `availability_mode = "regional"` and `vpc_id`; adding or removing
`availability_zone_address` blocks recreates the gateway (S4).

## Sources

S1 to S6 in the front matter.

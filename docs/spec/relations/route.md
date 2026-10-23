---
id: route
title: { vi: "Tuyến đường (route)", en: "Route" }
participants:
  - { role: table, service: route-table }
  - { role: target, service: [internet-gateway, nat-gateway] }    # first version; see decisions D-004 for later targets
direction: table->target
same_vpc: true
cardinality: { table: many, target: many }
user_drawn: true
generates:
  - { terraform: "aws_route", on: table }
properties:
  destination: { one_of: [destination_cidr_block, destination_ipv6_cidr_block, destination_prefix_list_id], default_for_gateways: "0.0.0.0/0" }
  target: { one_of: [gateway_id, nat_gateway_id] }
conditions:
  - { text: { vi: "Internet Gateway phải gắn với đúng VPC của route table", en: "The internet gateway must be attached to the route table's VPC" }, when: "target is internet-gateway" }
  - { text: { vi: "NAT Gateway phải cùng VPC", en: "The NAT gateway must be in the same VPC" }, when: "target is nat-gateway" }
effects:
  - "route to an internet gateway: subnets using the table become public"
  - "route to a NAT gateway: subnets using the table can start outbound connections to the internet, provided the NAT gateway's own subnet is public"
invalid_when: [VAL-009, VAL-010, VAL-016, VAL-017, VAL-028]
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html
  S2: https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html
  S3: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/route.html.markdown
  S4: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/route_table.html.markdown
  S5: https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html
status: verified          # VAL-016 and VAL-028 are unverified
---

# Route

## Meaning

A route sends traffic for a destination to a target. This is the connection that gives a subnet internet access,
directly (internet gateway) or outbound only (NAT gateway).

## Cases

| # | Route table | Destination | Target | Result |
|---|---|---|---|---|
| 1 | associated with public subnets | `0.0.0.0/0` | internet gateway | Public subnets. Resources also need a public IPv4 address |
| 2 | associated with private subnets | `0.0.0.0/0` | NAT gateway | Private subnets with outbound internet access |
| 3 | associated with private subnets | none | none | Isolated subnets, local traffic only |
| 4 | the NAT gateway's own subnet | `0.0.0.0/0` | internet gateway | Required for a zonal public NAT gateway to work (S5) |
| 5 | any | `0.0.0.0/0` | NAT gateway whose subnet is not public | NAT gateway created but no internet. [VAL-012](../rules/validation.md) |
| 6 | the NAT gateway's own subnet | `0.0.0.0/0` | that same NAT gateway | Traffic loops; invalid. [VAL-028](../rules/validation.md) |
| 7 | any | the same destination twice | any | Duplicate. [VAL-016](../rules/validation.md) |
| 8 | any | `0.0.0.0/0` | internet gateway **and** another table sends private subnets to the same gateway | Both fine; each table is independent |
| 9 | private subnet in AZ-a | `0.0.0.0/0` | NAT gateway in AZ-b | Works but cross-AZ. [VAL-013](../rules/validation.md) |

## Rules from AWS

- The local route for each VPC CIDR exists already and cannot be created (S1, S3).
- IPv4 and IPv6 are separate (S1).
- Longest prefix wins; static routes beat propagated routes on equal destinations (S2).
- No route may target `169.254.168.0/22` or `fd00:ec2::/32` (S1). [VAL-017](../rules/validation.md).
- A route more specific than the local route may only target a NAT gateway, network interface or Gateway Load
  Balancer endpoint (S1).
- Exactly one destination and exactly one target per route (S3). [VAL-009](../rules/validation.md).

## Failure modes

| Situation | Result |
|---|---|
| NAT gateway ID passed in `gateway_id` | Permanent diff; use `nat_gateway_id` (S3, S4) |
| Inline routes in `aws_route_table` plus `aws_route` | Conflicts and overwrites (S3, S4) |
| Route to an internet gateway not attached to this VPC | AWS rejects it. [VAL-010](../rules/validation.md) |

## Terraform mapping

One `aws_route` per entry: `route_table_id`, `destination_cidr_block`, and `gateway_id` for an internet
gateway or `nat_gateway_id` for a NAT gateway. Add `depends_on` on the gateway where ordering matters.

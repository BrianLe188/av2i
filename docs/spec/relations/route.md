---
id: route
title: { vi: "Tuyến đường (route)", en: "Route" }
participants:
  - { role: table, service: route-table }
  - { role: target, service: [internet-gateway, nat-gateway, vpc-endpoint-s3] }    # see decisions D-004 and D-029 for later targets
direction: table->target
same_vpc: true
cardinality: { table: many, target: many }
user_drawn: true
generates:
  - { terraform: "aws_route", on: table, when: "target is internet-gateway or nat-gateway" }
  - { terraform: "aws_vpc_endpoint_route_table_association (route_table_id, vpc_endpoint_id)", on: table, when: "target is vpc-endpoint-s3; AWS adds the route itself, so no aws_route is emitted" }
properties:
  destination: { one_of: [destination_cidr_block, destination_ipv6_cidr_block, destination_prefix_list_id], default_for_gateways: "0.0.0.0/0" }
  target: { one_of: [gateway_id, nat_gateway_id, vpc_endpoint_id] }
  endpoint_route: "destination is the S3 prefix list and is not editable; the user chooses only the table and the endpoint"
conditions:
  - { text: { vi: "Internet Gateway phải gắn với đúng VPC của route table", en: "The internet gateway must be attached to the route table's VPC" }, when: "target is internet-gateway" }
  - { text: { vi: "NAT Gateway phải cùng VPC", en: "The NAT gateway must be in the same VPC" }, when: "target is nat-gateway" }
  - { text: { vi: "Endpoint phải cùng VPC với route table, và mỗi route table chỉ có một endpoint S3", en: "The endpoint must be in the route table's VPC, and a table has at most one S3 endpoint" }, when: "target is vpc-endpoint-s3" }
effects:
  - "route to an internet gateway: subnets using the table become public"
  - "route to a NAT gateway: subnets using the table can start outbound connections to the internet, provided the NAT gateway's own subnet is public"
  - "route to an S3 gateway endpoint: subnets using the table reach S3 in the endpoint's Region without an internet gateway or NAT gateway; the endpoint route beats a 0.0.0.0/0 route for S3 traffic; it does not make the subnet public"
invalid_when: [VAL-009, VAL-010, VAL-016, VAL-017, VAL-028, VAL-122]
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html
  S2: https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html
  S3: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/route.html.markdown
  S4: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/route_table.html.markdown
  S6: https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html
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
| 10 | associated with private subnets | S3 prefix list | S3 gateway endpoint | Private subnets reach S3 in the same Region with no NAT gateway; other traffic still needs one (S6) |
| 11 | any | S3 prefix list | S3 gateway endpoint, alongside `0.0.0.0/0` to an internet gateway or NAT gateway | The endpoint route wins for S3 in the same Region; traffic to S3 in another Region and to other services uses the gateway (S6) |
| 12 | any | S3 prefix list | two S3 gateway endpoints | Not possible. [VAL-122](../rules/validation.md) |
| 13 | table in VPC-A | S3 prefix list | endpoint in VPC-B | Rejected. [VAL-122](../rules/validation.md) |

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

## Endpoint targets

The route to a gateway endpoint is a different kind of route. The user draws a line from a route table to the endpoint,
and the platform emits an `aws_vpc_endpoint_route_table_association`; AWS creates the route to the S3 prefix list and the
route cannot be edited by hand (S6, pitfalls P-070, P-071). The destination is therefore not a property the user sets,
and the duplicate-destination rule [VAL-016](../rules/validation.md) does not apply to it. See
[vpc-endpoint-s3](../services/vpc-endpoint-s3.md).

## Terraform mapping

One `aws_route` per entry: `route_table_id`, `destination_cidr_block`, and `gateway_id` for an internet
gateway or `nat_gateway_id` for a NAT gateway. Add `depends_on` on the gateway where ordering matters.

---
id: route-table
title: { vi: "Route Table (bảng định tuyến)", en: "Route table" }
terraform:
  resources: [aws_route_table, aws_route, aws_route_table_association]
scope: vpc
placement: { requires: [vpc], subnet_type: null, min_azs: null }
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html
  S2: https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html
  S3: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/route_table.html.markdown
  S4: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/route.html.markdown
  S5: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/route_table_association.html.markdown
  S6: https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html
  S7: https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html
properties:
  - key: vpc_id
    type: reference
    ref: vpc
    required: true
    src: [S3]
    status: verified
  - key: routes
    type: list
    item:
      destination: { one_of: [cidr_block, ipv6_cidr_block, destination_prefix_list_id] }
      target: { one_of: [gateway_id, nat_gateway_id, "... (see S4 for the full list)"] }
    constraints:
      - "exactly one destination and exactly one target per route"
      - "the local route for each VPC CIDR is added by AWS and cannot be specified"
      - "no route to 169.254.168.0/22 or fd00:ec2::/32"
      - "a route more specific than the local route may only target a NAT gateway, network interface or Gateway Load Balancer endpoint"
    src: [S1, S3, S4]
    status: verified
    scope_note: "first version targets: internet-gateway and nat-gateway only"
  - key: tags
    type: map
    src: [S3]
    status: verified
limits:
  - { id: route_tables_per_vpc, value: 200, adjustable: true, src: [S6], status: verified, note: "main route table counts" }
  - { id: routes_per_route_table, value: 500, adjustable: true, max: 1000, src: [S6], status: verified, note: "non-propagated, counted separately for IPv4 and IPv6" }
  - { id: propagated_routes_per_route_table, value: 100, adjustable: false, src: [S6], status: verified }
relations: [containment, route, route-association]
cost: { model: free, notes: "" }
status: verified
---

# Route table

## Purpose

A route table says where traffic from a subnet goes, by destination. It is the single thing that decides whether
a subnet is public or private.

## Behaviour

- Every route has a destination (CIDR or prefix list) and a target (gateway, NAT gateway, peering, and so on).
  IPv4 and IPv6 are independent: `0.0.0.0/0` does not cover IPv6 (S1).
- Every route table holds a **local route** for each VPC CIDR, so resources in the VPC reach each other without
  any configuration (S1).
- **Priority:** the most specific matching route wins (longest prefix). On equal destinations, static routes
  (internet gateway, NAT gateway, peering, gateway endpoint and others) beat propagated ones (S2).
- **Main route table:** created with the VPC. A subnet with no explicit association uses it. It cannot be
  deleted; you can edit its routes, or make another table the main one (S1). Keeping it local-only and
  associating each subnet explicitly with a custom table is the documented way to keep control (S1).
- **Public vs private:** a subnet whose route table has a route to an internet gateway is public, otherwise
  private (S7).
- A subnet has exactly one route table, but one table can serve many subnets (S1).
- A custom route table can be deleted only when it has no associations (S1).

## Placement

VPC level. Associated with subnets (or gateways) in the same VPC.

## Relations

- [route](../relations/route.md): the entries inside the table.
- [route-association](../relations/route-association.md): which subnets use the table.

## Failure modes

| Situation | Result |
|---|---|
| Two routes with the same destination in one table | AWS rejects the duplicate (unverified) |
| `gateway_id` given a NAT gateway ID | The API accepts it but returns a more specific attribute, causing a permanent diff; use `nat_gateway_id` (S3, S4) |
| Inline `route` blocks together with `aws_route` resources on the same table | Routes overwrite each other (S3, S4) |
| Associating a subnet that already has an explicit association | `Resource.AlreadyAssociated` (S5) |
| Route to `169.254.168.0/22` | Rejected; the range is reserved by AWS (S1) |
| Deleting a table that still has associations | Delete fails (S1) |

## Limits, cost, security

See front matter. No cost. Security: a `0.0.0.0/0` route to an internet gateway in a table shared with
databases quietly makes their subnets public; keep data subnets on their own table.

## Terraform mapping

`aws_route_table` (`vpc_id`), plus one `aws_route` per entry and one `aws_route_table_association` per subnet.
**Use either inline `route` blocks or `aws_route` resources for a given table, never both** (S3, S4). The
platform should emit `aws_route`, because inline blocks make the table own every route and an empty list
deletes them (S3). `aws_route_table_association` takes `subnet_id` or `gateway_id`, not both (S5).

## Sources

S1 to S7 in the front matter.

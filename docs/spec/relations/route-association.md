---
id: route-association
title: { vi: "Gắn Route Table vào Subnet", en: "Route table association" }
participants:
  - { role: table, service: route-table }
  - { role: subnet, service: subnet }
direction: undirected
same_vpc: true
cardinality: { table: many, subnet: one }      # a subnet has exactly one table; a table serves many subnets
user_drawn: true
generates:
  - { terraform: "aws_route_table_association", on: pair }
effects:
  - "decides whether the subnet is public or private (through the routes of the table)"
invalid_when: [VAL-014, VAL-015]
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/route_table_association.html.markdown
  S3: https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html
status: verified          # VAL-015 is unverified
---

# Route table association

## Meaning

Chooses the route table a subnet uses. Because the table's routes decide public or private, this is where a
subnet's exposure is set.

## Cases

| # | Situation | Subnet uses | Notes |
|---|---|---|---|
| 1 | One explicit association | that table | Normal case |
| 2 | No explicit association | the VPC's **main** route table (implicit) | The main table is local-only by default, so the subnet is private (S1) |
| 3 | Two explicit associations for one subnet | invalid | A subnet has one table (S1). [VAL-014](../rules/validation.md) |
| 4 | Table from another VPC | invalid | [VAL-015](../rules/validation.md) |
| 5 | One table for many subnets | all of them | Allowed (S1). They share fate: one `0.0.0.0/0` route makes all of them public |
| 6 | Main table later replaced by another | subnets with no explicit association follow the new main table (S1) | Avoid by always associating explicitly |
| 7 | Association to a gateway instead of a subnet (gateway route table) | | Out of scope for the first version (S2 allows `gateway_id`) |

## Public or private

A subnet is public when its table has a route to an internet gateway (S3). So a design check for "public
subnet" reads: subnet, its associated table (or the main table), a route in it to an internet gateway attached
to the VPC. Rules that need a public subnet (NAT placement, internet-facing load balancer) use this check, not
`map_public_ip_on_launch`.

## Failure modes

Associating a subnet that already has an explicit association gives `Resource.AlreadyAssociated`; the existing
association must be imported first (S2). A custom table with associations cannot be deleted until they are
removed (S1).

## Terraform mapping

`aws_route_table_association` with `subnet_id` and `route_table_id`. Do not set `gateway_id` in the same
resource (S2). The platform should always emit an explicit association for every subnet so no subnet silently
depends on the main route table (S1 recommends keeping the main table untouched).

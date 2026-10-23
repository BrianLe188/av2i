---
id: internet-gateway
title: { vi: "Internet Gateway (cổng Internet)", en: "Internet gateway (IGW)" }
terraform:
  resources: [aws_internet_gateway]
scope: vpc
placement: { requires: [vpc], subnet_type: null, min_azs: null }
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/internet_gateway.html.markdown
  S3: https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html
  S4: https://docs.aws.amazon.com/vpc/latest/userguide/delete-igw.html
properties:
  - key: vpc_id
    type: reference
    ref: vpc
    required: true            # platform choice; the provider marks it optional (attachment resource is the alternative)
    src: [S2]
    status: verified
  - key: tags
    type: map
    src: [S2]
    status: verified
limits:
  - { id: igws_per_region, value: 5, adjustable: true, src: [S3], status: verified, note: "raise the VPCs-per-Region quota to raise it" }
  - { id: igws_per_vpc, value: 1, adjustable: false, src: [S3], status: verified }
relations: [igw-attach, route]
cost: { model: free, notes: "no charge for the gateway, data transfer is charged (S1)" }
status: verified
---

# Internet gateway

## Purpose

Lets a VPC exchange traffic with the internet, over IPv4 and IPv6. It is horizontally scaled, redundant and
highly available, and does not limit bandwidth (S1).

## Behaviour

- It does nothing until it is **attached** to a VPC and a route table sends traffic to it (S1).
- For IPv4 it performs one-to-one NAT between a resource's private address and its public IPv4 or Elastic IP
  address (S1). A resource with no public address cannot use the gateway for IPv4 even when the route exists
  (S1).
- Internet access for a resource needs all of: an attached gateway, a route to it in the subnet's route table,
  a public IPv4 (or IPv6) address, and security groups that allow the traffic (S1).
- One gateway per VPC (S3). A new non-default VPC has no gateway and no route to one (S1).
- It is not placed in a subnet and has no security group.

## Placement

VPC level. Attached to exactly one VPC at a time.

## Relations

- [igw-attach](../relations/igw-attach.md): attachment to the VPC.
- [route](../relations/route.md): a route in a route table targets it; that makes subnets public.

## Failure modes

| Situation | Result |
|---|---|
| Detaching while the VPC has resources with public or Elastic IP addresses | Detach fails (S4) |
| Deleting while still attached | Delete fails (S4) |
| Gateway attached and routed, but the instance has no public address | No internet access (S1) |
| EIP or instance created before the gateway exists | May fail; the provider recommends `depends_on` the gateway (S2) |

## Limits, cost, security

See front matter. Exposure comes from the route plus public addresses plus security groups, not from the gateway
itself. Rules [SEC-001, SEC-002](../rules/security.md) cover world-open ports.

## Terraform mapping

`aws_internet_gateway` with `vpc_id`. The alternative `aws_internet_gateway_attachment` exists; use one style
per gateway, not both (S2). Resources that depend on the gateway (EIP, NAT gateway, instance) take
`depends_on = [aws_internet_gateway.<x>]` (S2).

## Sources

S1 to S4 in the front matter.

---
id: igw-attach
title: { vi: "Gắn Internet Gateway vào VPC", en: "Internet gateway attachment" }
participants:
  - { role: gateway, service: internet-gateway }
  - { role: network, service: vpc }
direction: undirected
same_vpc: true
cardinality: { gateway: one, network: one }   # one VPC per gateway and one gateway per VPC
user_drawn: false                              # derived from nesting, like containment
generates:
  - { terraform: "aws_internet_gateway.vpc_id", on: gateway }
effects:
  - "A route to the gateway in a route table makes the subnets using that table public (see route)"
invalid_when: [VAL-007, VAL-008]
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html
  S2: https://docs.aws.amazon.com/vpc/latest/userguide/delete-igw.html
  S3: https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html
  S4: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/internet_gateway.html.markdown
status: verified
---

# Internet gateway attachment

## Meaning

The gateway is attached to one VPC and gives that VPC a target for internet-bound routes. Attachment alone does
not give internet access (S1).

## Cases

1. **VPC with no gateway.** Fully private. Valid. Nothing in it is reachable from the internet, and nothing can
   reach out unless a NAT gateway has an internet gateway to use, which it cannot without one.
2. **VPC with one gateway, no route to it.** Valid but useless. Every subnet is private.
3. **VPC with one gateway and a route in some subnets' tables.** The usual public/private split.
4. **Second gateway in the same VPC.** Invalid: one per VPC (S3). [VAL-007](../rules/validation.md).
5. **Gateway not attached to any VPC.** Allowed by Terraform (the argument is optional, S4) but does nothing.
   [VAL-008](../rules/validation.md).
6. **Detaching or deleting while public addresses are in use.** Fails until those Elastic IPs and public
   addresses are released (S2). This affects destroy order: resources with public addresses go first.

## Failure modes

Deleting an attached gateway fails (S2). Detaching with public or Elastic IPs in use fails (S2). A resource that
needs the gateway to exist before it can be created (Elastic IP association, NAT gateway, instance with public
IP) can fail on ordering; the provider recommends `depends_on` the gateway (S4).

## Terraform mapping

`aws_internet_gateway.vpc_id = aws_vpc.<x>.id`. Do not also create an `aws_internet_gateway_attachment` for the
same gateway (S4). Add `depends_on = [aws_internet_gateway.<x>]` to Elastic IPs, NAT gateways and instances
that need internet access.

---
id: nat-placement
title: { vi: "Đặt NAT Gateway vào Subnet", en: "NAT gateway placement" }
participants:
  - { role: gateway, service: nat-gateway }
  - { role: host, service: subnet }
direction: gateway->host
same_vpc: true
cardinality: { gateway: one, host: many }     # a subnet may hold several gateways; a zonal gateway has one subnet
user_drawn: false                              # derived from nesting
generates:
  - { terraform: "aws_nat_gateway.subnet_id", on: gateway }
  - { terraform: "aws_nat_gateway.allocation_id, from the eip-attach connection", on: gateway, when: "public zonal" }
  - { terraform: "depends_on = [aws_internet_gateway.<x>]", on: gateway, when: "public" }
conditions:
  - { text: { vi: "NAT Gateway công khai phải nằm trong subnet public (có route tới Internet Gateway)", en: "A public NAT gateway must sit in a public subnet (one with a route to an internet gateway)" }, when: "public zonal" }
invalid_when: [VAL-011, VAL-012, VAL-013]
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html
  S2: https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html
  S3: https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateways-regional.html
  S4: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/nat_gateway.html.markdown
  S5: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/eip.html.markdown
status: verified
---

# NAT gateway placement

## Meaning

A zonal NAT gateway is created in one subnet, which fixes its AZ. For internet egress to work the whole chain
must be right:

```
private subnet --route 0.0.0.0/0--> NAT gateway (in public subnet) --route 0.0.0.0/0--> internet gateway --> internet
                                         |
                                    Elastic IP (public gateway)
```

## Cases

| # | Situation | Result |
|---|---|---|
| 1 | Public zonal gateway in a public subnet, with an Elastic IP, private subnets routed to it | Works (S1) |
| 2 | Same, but the gateway's subnet has no route to an internet gateway | Gateway exists, no internet. [VAL-012](../rules/validation.md) |
| 3 | Public zonal gateway with no Elastic IP | Invalid: required at creation (S1, S4). [VAL-011](../rules/validation.md) |
| 4 | Private gateway | No Elastic IP; for other VPCs or on-premises through a transit or virtual private gateway. An internet-gateway route from it drops traffic (S1). Out of scope for the first version |
| 5 | One gateway for private subnets in several AZs | Works, but an outage of the gateway's AZ cuts the others off (S2) |
| 6 | One gateway per AZ, each private subnet routed to its own AZ's gateway | The recommended resilient layout (S2). More Elastic IPs and more cost |
| 7 | Private subnet routed to a gateway in another AZ | Works with cross-AZ cost. [VAL-013](../rules/validation.md) |
| 8 | Regional gateway | No subnet, no public subnet needed, AWS manages AZ coverage and its own route table (S3). Decision D-002 |
| 9 | More gateways in an AZ than the quota (5) | AWS rejects it (S2, S4). Counted in pending, active and deleting states |
| 10 | More gateways than Elastic IPs available in the Region (5 by default) | Allocation fails |

## Failure modes

- No internet-gateway dependency: the gateway or its Elastic IP can be created before the internet gateway is
  attached and fail. Use `depends_on` (S4, S5).
- Attaching the Elastic IP through `network_interface` instead of `allocation_id` gives `AuthFailure` (S5).
- The gateway needs time to become available before routes can use it; Terraform waits for it (S4 timeouts:
  create 10 minutes, delete 30 minutes).

## Terraform mapping

```hcl
resource "aws_eip" "nat" {
  domain     = "vpc"
  depends_on = [aws_internet_gateway.main]
}
resource "aws_nat_gateway" "a" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public_a.id
  depends_on    = [aws_internet_gateway.main]
}
```

This is illustrative of the shape; exact attributes are in [nat-gateway](../services/nat-gateway.md) (S4, S5).

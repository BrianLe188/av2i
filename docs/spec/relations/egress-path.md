---
id: egress-path
title: { vi: "Đường ra ngoài của workload", en: "Egress path" }
participants:
  - { role: workload, service: [ec2, ecs, lambda] }
  - { role: route, service: [route-table, internet-gateway, nat-gateway, vpc-endpoint-s3] }
direction: workload->outside
same_vpc: true
cardinality: { workload: many, route: one }
user_drawn: false                  # derived from placement, routes and addresses; the platform reports it
derived: true
properties:
  public_subnet: "the workload's subnet uses a route table with a route to an internet gateway attached to the VPC"
  nat_egress: "the workload's subnet uses a route table with 0.0.0.0/0 to a NAT gateway that itself has a path to an internet gateway"
  public_address: "the workload has a public IPv4 address (EC2 associate_public_ip_address, ECS assign_public_ip); Lambda never has one"
  result_values: [direct, via_nat, none]
evaluation:
  direct:   "public_subnet AND public_address"
  via_nat:  "NOT public_subnet AND nat_egress"       # also valid for a public subnet without a public address when its table routes to a NAT gateway
  none:     "otherwise"
  s3_path:  "internet_egress OR (the route table of the subnet is associated with an S3 gateway endpoint AND the bucket is in the Region of the VPC)"
invalid_when: [VAL-012, VAL-013, VAL-031, VAL-032, VAL-131, VAL-038, VAL-042, VAL-045, VAL-070, VAL-126]
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html
  S2: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html
  S3: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html
  S4: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html
  S5: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-instance-addressing.html
status: verified
---

# Egress path

## Meaning

Whether a workload can reach the internet, or AWS public endpoints such as ECR, CloudWatch and S3, depends on
placement, routes and addresses together. This mechanism is how the platform computes the answer and explains
it. It is derived: the user draws subnets, route tables and gateways, and the platform reports what each
workload gets.

## Evaluation

```
public_subnet(s)   := route table of s has a route to an internet gateway attached to the VPC      (S1)
nat_egress(s)      := route table of s has 0.0.0.0/0 -> NAT gateway n,
                      and n (zonal public) sits in a subnet with public_subnet = true             (S2)
direct(w)          := public_subnet(w.subnet) AND w has a public IPv4 address                      (S1, S5)
via_nat(w)         := nat_egress(w.subnet)
internet_egress(w) := direct(w) OR via_nat(w)
s3_path(w, b)      := internet_egress(w) OR (s3_endpoint(w.subnet) AND region(b) = region(w.vpc))   (S6)
```

A regional NAT gateway replaces the "sits in a public subnet" condition with "is attached to the VPC and has an
internet-gateway route in its own table" (S2, decision D-002).

## Cases

| # | Workload | Subnet and routes | Result |
|---|---|---|---|
| 1 | EC2 | public subnet, public address | Direct internet access, reachable from outside if security groups allow (S1) |
| 2 | EC2 | public subnet, no public address | No internet access, even with the gateway route (S1). Rule [VAL-131](../rules/validation.md) |
| 3 | EC2 | private subnet, NAT gateway route | Outbound only (S2) |
| 4 | EC2 | private subnet, no NAT | No internet and no AWS public endpoints. Rule [VAL-032](../rules/validation.md) |
| 5 | EC2 | public subnet, public address, but the subnet's table has no internet-gateway route | Address is useless. Rule [VAL-031](../rules/validation.md) |
| 6 | Lambda, not attached to a VPC | not applicable | Internet access through Lambda's own VPC; no access to your private resources (S3) |
| 7 | Lambda, attached to private subnets with NAT | | Internet outbound through NAT (S3) |
| 8 | Lambda, attached to private subnets without NAT | | Only VPC resources; internet calls time out (S3). Rule [VAL-032](../rules/validation.md) |
| 9 | Lambda, attached to a public subnet | | No internet and no public IP (S3). Rule [VAL-038](../rules/validation.md) |
| 10 | ECS task, public subnet, `assign_public_ip` true | | Direct; can pull images (S4) |
| 11 | ECS task, public subnet, `assign_public_ip` false, no NAT | | Cannot pull images. Rule [VAL-042](../rules/validation.md) |
| 12 | ECS task, private subnet with NAT | | Can pull images and send logs (S4) |
| 13 | ECS task, private subnet, no NAT, ECR interface endpoint | | Image pull works over the private address (S4). The interface endpoint is Tier 2, so the platform cannot draw it; the S3 gateway endpoint does not help an ECR pull on its own |
| 14 | ECS task, private subnet, `assign_public_ip` true | | Has no effect. Rule [VAL-045](../rules/validation.md) |
| 15 | Any, NAT gateway in another AZ | | Works with cross-AZ cost. Rule [VAL-013](../rules/validation.md) |
| 16 | Any, NAT gateway's own subnet has no internet-gateway route | | No egress. Rule [VAL-012](../rules/validation.md) |
| 17 | Any, IPv6 | | Needs an egress-only internet gateway; out of scope (decision D-003) |
| 18 | EC2, ECS or Lambda, private subnet, no NAT, S3 gateway endpoint on the table | | Reaches S3 in the same Region; the internet and other AWS services stay unreachable. `internet_egress` is still false, `s3_path` is true |
| 19 | Same, bucket in another Region | | No path to the bucket. Rule [VAL-126](../rules/validation.md) |
| 20 | Private subnet, no NAT, no endpoint, workload uses S3 | | No path. Rule [VAL-070](../rules/validation.md) |

## Reporting

Where the result is `none` the platform should say why and what would fix it. The text is per case: "add a NAT
gateway and a route", "move to a private subnet", "assign a public address", "use a private subnet". It should
be info or warning, not error, because a workload that only talks inside the VPC is valid.

## Failure modes

The usual symptom is a timeout with no error message: a Lambda call that never returns, an ECS task stuck in
`PENDING` while it fails to pull an image, an instance that cannot install packages. This mechanism exists so
these are caught before deployment.

## Terraform mapping

None of its own. It reads the generated routes (`aws_route`), associations (`aws_route_table_association`),
gateways and the addresses set on the workload.

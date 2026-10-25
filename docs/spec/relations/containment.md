---
id: containment
title: { vi: "Chứa / đặt trong", en: "Containment (placement)" }
participants:
  - { role: parent, service: vpc }
  - { role: child_vpc_level, service: [subnet, route-table, security-group, internet-gateway, nat-gateway, vpc-endpoint-s3, db-subnet-group, rds] }
  - { role: child_subnet_level, service: [nat-gateway, ec2, ecs, lambda, alb, db-subnet-group] }
direction: parent->child
same_vpc: true
cardinality: { parent: one, child: one }     # a child has exactly one VPC; subnet-level children have one or more subnets (see cases)
user_drawn: false                            # derived from nesting on the canvas, not a drawn connection
generates:
  - { terraform: "vpc_id", on: "subnet, route-table, security-group, internet-gateway" }
  - { terraform: "subnet_id", on: "nat-gateway (zonal)" }
invalid_when: [VAL-004, VAL-005, VAL-027]
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/subnet.html.markdown
status: verified              # for the network services; compute, database and load balancer rows are pending their own files
---

# Containment

Containment says which VPC, and for some resources which subnet, a resource belongs to. It is not a connection
the user draws. It is the nesting on the canvas, and every mechanism marked `same_vpc` is checked against it.

## Levels

| Child | Lives in | How many | Notes |
|---|---|---|---|
| subnet | one VPC and one AZ | exactly one VPC | CIDR inside the VPC range, no overlap (S1) |
| route-table | one VPC | exactly one VPC | |
| security-group | one VPC | exactly one VPC | |
| internet-gateway | one VPC (attached) | exactly one VPC | see [igw-attach](igw-attach.md) |
| vpc-endpoint-s3 | one VPC | exactly one VPC | no subnet; used through route table associations (see [vpc-endpoint-s3](../services/vpc-endpoint-s3.md)) |
| nat-gateway, zonal | one subnet | exactly one subnet | public subnet for a public gateway |
| nat-gateway, regional | one VPC | no subnet | see decision D-002 |
| ec2 | exactly one subnet | one | One primary network interface, so one subnet and one AZ (verified, see [ec2](../services/ec2.md)) |
| ecs (Fargate service) | 1 to 16 subnets | many | Each task gets one network interface in one of the subnets (verified, see [ecs](../services/ecs.md)). Two or more AZs recommended |
| lambda | none, or 1 or more subnets of one VPC | optional | Hyperplane interfaces in the chosen subnets; two or more AZs recommended; a VPC with dedicated tenancy is not supported (verified, see [lambda](../services/lambda.md)) |
| ecr | none | none | Regional, outside any VPC |
| db-subnet-group | 2 to 20 subnets, in at least two AZs, one VPC | many | The group is the set of subnets RDS may use; a line from each subnet adds it (verified, see [db-subnet-group](../services/db-subnet-group.md)) |
| rds | none | none | The instance sits in the VPC and uses a DB subnet group; RDS picks the subnet and so the AZ (verified, see [rds](../services/rds.md) and [db-subnet-group](db-subnet-group.md)) |
| s3 | none | none | Regional, outside any VPC |
| alb | at least 2 subnets, one per AZ, in one VPC | many | Public subnets for internet-facing, private for internal (the public requirement is `unverified`). Each subnet at least /27 with 8 free addresses (verified, see [alb](../services/alb.md)) |
| route53, cloudfront | none | none | Global, outside any VPC |
| acm | none | none | Regional, outside any VPC; CloudFront certificates in us-east-1 |

## Cases

1. **Resource placed outside any VPC.** Subnet, route table, security group, internet gateway and zonal NAT
   gateway cannot exist without their parent. Export must be blocked.
2. **Subnet-level resource placed directly in the VPC, not a subnet.** Invalid for everything that needs a
   subnet; valid only for the regional NAT gateway.
3. **Resource moved to another VPC.** Every connection that required the same VPC becomes invalid and must
   be removed or flagged (security group attachments and references, route associations, NAT routes).
4. **Subnet CIDR changed or moved outside the VPC range.** [VAL-004](../rules/validation.md).
5. **Two subnets overlap.** [VAL-005](../rules/validation.md).
6. **Subnet in the default VPC of the account.** Out of scope: the specification only designs VPCs it creates.

## Failure modes

AWS rejects a subnet outside the VPC range or overlapping another subnet (S1). Deleting a subnet that still
holds network interfaces fails, and Lambda interfaces can delay it up to 45 minutes (S2).

## Terraform mapping

`vpc_id = aws_vpc.<x>.id` on every VPC-level child; `subnet_id = aws_subnet.<x>.id` on a zonal NAT gateway.
The reference also gives Terraform the creation and destruction order.

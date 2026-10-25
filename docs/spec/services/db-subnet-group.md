---
id: db-subnet-group
title: { vi: "Nhóm subnet của cơ sở dữ liệu (DB subnet group)", en: "DB subnet group" }
terraform:
  resources: [aws_db_subnet_group]
scope: vpc
placement: { requires: [vpc], subnet_type: private, min_azs: 2 }
sources:
  S1: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/db_subnet_group.html.markdown
  S3: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html
properties:
  - key: name
    type: string
    required: true
    constraints: ["1 to 255 characters: letters, numbers, spaces, hyphens, underscores, periods", "changing it replaces the group"]
    force_new: true
    src: [S2, S3]
    status: verified
    note: "defaults to the node key with hyphens"
  - key: description
    type: string
    default: "Managed by av2i"
    constraints: ["the provider default is Managed by Terraform"]
    src: [S2]
    status: verified
  - key: tags
    type: map
    src: [S2]
    status: verified
limits:
  - { id: db_subnet_groups, value: 50, adjustable: true, src: [S3], status: verified, note: "20 in ap-south-1" }
  - { id: subnets_per_db_subnet_group, value: 20, adjustable: false, src: [S3], status: verified }
relations: [containment, db-subnet-group]
cost: { model: free, notes: "no charge for the group itself" }
status: verified
---

# DB subnet group

## Purpose

The set of subnets RDS may place a DB instance in. It is a resource of its own in AWS: you create it first, then name it
when you create an instance (S1). Several instances may use one group.

## Behaviour

- It holds 2 to 20 subnets of **one VPC** that together cover **at least two Availability Zones**, even for a single-AZ
  instance, so that a standby can be placed in another AZ (S1, S3).
- RDS picks one subnet of the group and one address in it for the instance, and the instance runs in that subnet's AZ.
  The user does not choose the subnet; to pin the AZ, set `availability_zone` on the instance (S1).
- The group is typically made of private subnets. For a publicly accessible instance every subnet of the group must be
  public (S1). Rules [VAL-058, VAL-062, VAL-067](../rules/validation.md).

## Placement

VPC level. The members are the subnets drawn into it with a line: on the canvas a group is "these subnets".

## Relations

- [containment](../relations/containment.md): the VPC holds the group, and a line from a subnet adds that subnet.
- [db-subnet-group](../relations/db-subnet-group.md): the instances that use the group.

## Failure modes

See [db-subnet-group](../relations/db-subnet-group.md).

## Terraform mapping

`aws_db_subnet_group` with `name`, `description`, `subnet_ids`. The instance's `db_subnet_group_name` refers to its
`name` (S2).

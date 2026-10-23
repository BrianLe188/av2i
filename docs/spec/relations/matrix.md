---
id: relation-matrix
title: { vi: "Ma trận quan hệ giữa các service", en: "Service relation matrix" }
services: [vpc, subnet, internet-gateway, nat-gateway, route-table, vpc-endpoint-s3, security-group, ec2, lambda, ecs, ecr, s3, rds, alb, route53, cloudfront, acm, iam-role, iam-policy]
cell_values: [valid, conditional, invalid, none]
direction: "a cell reads from the row service to the column service, in the direction the mechanism is drawn or derived"
counts: { valid: 39, conditional: 20, invalid: 40, none: 262 }
status: unverified
pairs:
  - { from: vpc, to: vpc, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: vpc, to: subnet, value: valid, mechanism: "containment", note: "a subnet belongs to exactly one VPC; derived from nesting" }
  - { from: vpc, to: internet-gateway, value: valid, mechanism: "igw-attach", note: "one gateway per VPC and one VPC per gateway; derived from nesting" }
  - { from: vpc, to: nat-gateway, value: conditional, mechanism: "containment", note: "regional mode only (D-002); a zonal gateway is placed in a subnet instead" }
  - { from: vpc, to: route-table, value: valid, mechanism: "containment", note: "a route table belongs to one VPC; derived from nesting" }
  - { from: vpc, to: vpc-endpoint-s3, value: valid, mechanism: "containment", note: "an S3 gateway endpoint belongs to one VPC and serves S3 in the VPC's Region; derived from nesting" }
  - { from: vpc, to: security-group, value: valid, mechanism: "containment", note: "a security group belongs to one VPC; derived from nesting" }
  - { from: vpc, to: ec2, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc, to: lambda, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc, to: ecs, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc, to: rds, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc, to: alb, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc, to: iam-role, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: subnet, to: vpc, value: invalid, mechanism: "-", note: "direction: containment is drawn from vpc to subnet" }
  - { from: subnet, to: subnet, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: subnet, to: internet-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: subnet, to: nat-gateway, value: invalid, mechanism: "-", note: "direction: nat-placement is drawn from nat-gateway to subnet" }
  - { from: subnet, to: route-table, value: valid, mechanism: "route-association", note: "a subnet has exactly one table; the table decides public or private" }
  - { from: subnet, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: subnet, to: security-group, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: subnet, to: ec2, value: valid, mechanism: "containment", note: "an instance runs in exactly one subnet" }
  - { from: subnet, to: lambda, value: conditional, mechanism: "containment", note: "only when the function is attached to the VPC; private subnets, two or more AZs recommended" }
  - { from: subnet, to: ecs, value: valid, mechanism: "containment", note: "tasks run in 1 to 16 subnets of one VPC" }
  - { from: subnet, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: subnet, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: subnet, to: rds, value: conditional, mechanism: "containment", note: "placed through a DB subnet group of 2 to 20 subnets in at least two AZs; see db-subnet-group" }
  - { from: subnet, to: alb, value: conditional, mechanism: "containment", note: "at least two subnets in different AZs, each at least /27 with 8 free addresses" }
  - { from: subnet, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: subnet, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: subnet, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: subnet, to: iam-role, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: subnet, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: internet-gateway, to: vpc, value: valid, mechanism: "igw-attach", note: "one gateway per VPC and one VPC per gateway; derived from nesting" }
  - { from: internet-gateway, to: subnet, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: internet-gateway, to: internet-gateway, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: internet-gateway, to: nat-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: internet-gateway, to: route-table, value: invalid, mechanism: "-", note: "direction: route is drawn from route-table to internet-gateway" }
  - { from: internet-gateway, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: internet-gateway, to: security-group, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: internet-gateway, to: ec2, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: internet-gateway, to: lambda, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: internet-gateway, to: ecs, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: internet-gateway, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: internet-gateway, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: internet-gateway, to: rds, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: internet-gateway, to: alb, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: internet-gateway, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: internet-gateway, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: internet-gateway, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: internet-gateway, to: iam-role, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: internet-gateway, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: nat-gateway, to: vpc, value: invalid, mechanism: "-", note: "direction: containment is drawn from vpc to nat-gateway" }
  - { from: nat-gateway, to: subnet, value: conditional, mechanism: "nat-placement", note: "zonal mode only; a public zonal gateway needs a public subnet and an Elastic IP" }
  - { from: nat-gateway, to: internet-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: nat-gateway, to: nat-gateway, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: nat-gateway, to: route-table, value: invalid, mechanism: "-", note: "direction: route is drawn from route-table to nat-gateway" }
  - { from: nat-gateway, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: nat-gateway, to: security-group, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: nat-gateway, to: ec2, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: nat-gateway, to: lambda, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: nat-gateway, to: ecs, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: nat-gateway, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: nat-gateway, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: nat-gateway, to: rds, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: nat-gateway, to: alb, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: nat-gateway, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: nat-gateway, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: nat-gateway, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: nat-gateway, to: iam-role, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: nat-gateway, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route-table, to: vpc, value: invalid, mechanism: "-", note: "direction: containment is drawn from vpc to route-table" }
  - { from: route-table, to: subnet, value: valid, mechanism: "route-association", note: "a subnet has exactly one table; the table decides public or private" }
  - { from: route-table, to: internet-gateway, value: valid, mechanism: "route", note: "a route to the gateway; the gateway must be attached to the table's VPC" }
  - { from: route-table, to: nat-gateway, value: valid, mechanism: "route", note: "a route to the gateway; same VPC; the gateway's own subnet must be public" }
  - { from: route-table, to: route-table, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: route-table, to: vpc-endpoint-s3, value: valid, mechanism: "route", note: "associates the table with the endpoint (aws_vpc_endpoint_route_table_association); same VPC, one S3 endpoint per table; AWS adds the route" }
  - { from: route-table, to: security-group, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route-table, to: ec2, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: route-table, to: lambda, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: route-table, to: ecs, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: route-table, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route-table, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route-table, to: rds, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route-table, to: alb, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route-table, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route-table, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route-table, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route-table, to: iam-role, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route-table, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc-endpoint-s3, to: vpc, value: invalid, mechanism: "-", note: "direction: containment is drawn from vpc to vpc-endpoint-s3" }
  - { from: vpc-endpoint-s3, to: subnet, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc-endpoint-s3, to: internet-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc-endpoint-s3, to: nat-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc-endpoint-s3, to: route-table, value: invalid, mechanism: "-", note: "direction: route is drawn from route-table to vpc-endpoint-s3" }
  - { from: vpc-endpoint-s3, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: vpc-endpoint-s3, to: security-group, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc-endpoint-s3, to: ec2, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: vpc-endpoint-s3, to: lambda, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: vpc-endpoint-s3, to: ecs, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: vpc-endpoint-s3, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc-endpoint-s3, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc-endpoint-s3, to: rds, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc-endpoint-s3, to: alb, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc-endpoint-s3, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc-endpoint-s3, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc-endpoint-s3, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc-endpoint-s3, to: iam-role, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: vpc-endpoint-s3, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: security-group, to: vpc, value: invalid, mechanism: "-", note: "direction: containment is drawn from vpc to security-group" }
  - { from: security-group, to: subnet, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: security-group, to: internet-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: security-group, to: nat-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: security-group, to: route-table, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: security-group, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: security-group, to: security-group, value: valid, mechanism: "sg-reference", note: "a rule names another group as source or destination, same VPC; no rules are copied" }
  - { from: security-group, to: ec2, value: valid, mechanism: "sg-attach", note: "up to 5 groups per network interface" }
  - { from: security-group, to: lambda, value: conditional, mechanism: "sg-attach", note: "only when the function is attached to a VPC" }
  - { from: security-group, to: ecs, value: valid, mechanism: "sg-attach", note: "attached to the task's interface; 1 to 5 groups" }
  - { from: security-group, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: security-group, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: security-group, to: rds, value: valid, mechanism: "sg-attach", note: "attached through vpc_security_group_ids" }
  - { from: security-group, to: alb, value: valid, mechanism: "sg-attach", note: "required for an application load balancer" }
  - { from: security-group, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: security-group, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: security-group, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: security-group, to: iam-role, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: security-group, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ec2, to: vpc, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ec2, to: subnet, value: invalid, mechanism: "-", note: "direction: containment is drawn from subnet to ec2" }
  - { from: ec2, to: internet-gateway, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: ec2, to: nat-gateway, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: ec2, to: route-table, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: ec2, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: ec2, to: security-group, value: valid, mechanism: "sg-attach", note: "up to 5 groups per network interface" }
  - { from: ec2, to: ec2, value: valid, mechanism: "network-access", note: "same VPC; implemented as ingress on the callee's group referencing the caller's group" }
  - { from: ec2, to: lambda, value: invalid, mechanism: "-", note: "direction: network-access is drawn from lambda to ec2" }
  - { from: ec2, to: ecs, value: valid, mechanism: "network-access", note: "same VPC; implemented as ingress on the callee's group referencing the caller's group" }
  - { from: ec2, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ec2, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ec2, to: rds, value: valid, mechanism: "network-access", note: "same VPC; implemented as ingress on the callee's group referencing the caller's group" }
  - { from: ec2, to: alb, value: invalid, mechanism: "-", note: "direction: listener-target is drawn from alb to ec2" }
  - { from: ec2, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ec2, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ec2, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ec2, to: iam-role, value: invalid, mechanism: "-", note: "direction: assume-role is drawn from iam-role to ec2" }
  - { from: ec2, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: lambda, to: vpc, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: lambda, to: subnet, value: invalid, mechanism: "-", note: "direction: containment is drawn from subnet to lambda" }
  - { from: lambda, to: internet-gateway, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: lambda, to: nat-gateway, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: lambda, to: route-table, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: lambda, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: lambda, to: security-group, value: conditional, mechanism: "sg-attach", note: "only when the function is attached to a VPC" }
  - { from: lambda, to: ec2, value: conditional, mechanism: "network-access", note: "the function must be attached to the same VPC" }
  - { from: lambda, to: lambda, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: lambda, to: ecs, value: conditional, mechanism: "network-access", note: "the function must be attached to the same VPC" }
  - { from: lambda, to: ecr, value: invalid, mechanism: "-", note: "direction: image-source is drawn from ecr to lambda" }
  - { from: lambda, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: lambda, to: rds, value: conditional, mechanism: "network-access", note: "the function must be attached to the same VPC" }
  - { from: lambda, to: alb, value: invalid, mechanism: "-", note: "direction: listener-target is drawn from alb to lambda" }
  - { from: lambda, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: lambda, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: lambda, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: lambda, to: iam-role, value: invalid, mechanism: "-", note: "direction: assume-role is drawn from iam-role to lambda" }
  - { from: lambda, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecs, to: vpc, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecs, to: subnet, value: invalid, mechanism: "-", note: "direction: containment is drawn from subnet to ecs" }
  - { from: ecs, to: internet-gateway, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: ecs, to: nat-gateway, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: ecs, to: route-table, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: ecs, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "derived only: reaching the internet is reported by egress-path, never drawn" }
  - { from: ecs, to: security-group, value: valid, mechanism: "sg-attach", note: "attached to the task's interface; 1 to 5 groups" }
  - { from: ecs, to: ec2, value: valid, mechanism: "network-access", note: "same VPC; implemented as ingress on the callee's group referencing the caller's group" }
  - { from: ecs, to: lambda, value: invalid, mechanism: "-", note: "direction: network-access is drawn from lambda to ecs" }
  - { from: ecs, to: ecs, value: valid, mechanism: "network-access", note: "same VPC; implemented as ingress on the callee's group referencing the caller's group" }
  - { from: ecs, to: ecr, value: invalid, mechanism: "-", note: "direction: image-source is drawn from ecr to ecs" }
  - { from: ecs, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecs, to: rds, value: valid, mechanism: "network-access", note: "same VPC; implemented as ingress on the callee's group referencing the caller's group" }
  - { from: ecs, to: alb, value: invalid, mechanism: "-", note: "direction: listener-target is drawn from alb to ecs" }
  - { from: ecs, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecs, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecs, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecs, to: iam-role, value: invalid, mechanism: "-", note: "direction: assume-role is drawn from iam-role to ecs" }
  - { from: ecs, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: vpc, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: subnet, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: internet-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: nat-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: route-table, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: security-group, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: ec2, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: lambda, value: conditional, mechanism: "image-source", note: "the repository must be in the function's own Region; one architecture" }
  - { from: ecr, to: ecs, value: valid, mechanism: "image-source", note: "the execution role must be allowed to pull; the task needs a network path to ECR" }
  - { from: ecr, to: ecr, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: ecr, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: rds, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: alb, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: ecr, to: iam-role, value: invalid, mechanism: "-", note: "direction: grant is drawn from iam-role to ecr" }
  - { from: ecr, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: vpc, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: subnet, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: internet-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: nat-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: route-table, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: security-group, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: ec2, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: lambda, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: ecs, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: s3, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: s3, to: rds, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: alb, value: invalid, mechanism: "-", note: "direction: resource-policy is drawn from alb to s3" }
  - { from: s3, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: cloudfront, value: invalid, mechanism: "-", note: "direction: origin is drawn from cloudfront to s3" }
  - { from: s3, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: s3, to: iam-role, value: invalid, mechanism: "-", note: "direction: grant is drawn from iam-role to s3" }
  - { from: s3, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: rds, to: vpc, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: rds, to: subnet, value: conditional, mechanism: "db-subnet-group", note: "2 to 20 subnets in at least two AZs of one VPC" }
  - { from: rds, to: internet-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: rds, to: nat-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: rds, to: route-table, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: rds, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: rds, to: security-group, value: valid, mechanism: "sg-attach", note: "attached through vpc_security_group_ids" }
  - { from: rds, to: ec2, value: invalid, mechanism: "-", note: "direction: network-access is drawn from ec2 to rds" }
  - { from: rds, to: lambda, value: invalid, mechanism: "-", note: "direction: network-access is drawn from lambda to rds" }
  - { from: rds, to: ecs, value: invalid, mechanism: "-", note: "direction: network-access is drawn from ecs to rds" }
  - { from: rds, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: rds, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: rds, to: rds, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: rds, to: alb, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: rds, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: rds, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: rds, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: rds, to: iam-role, value: invalid, mechanism: "-", note: "direction: assume-role is drawn from iam-role to rds" }
  - { from: rds, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: alb, to: vpc, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: alb, to: subnet, value: invalid, mechanism: "-", note: "direction: containment is drawn from subnet to alb" }
  - { from: alb, to: internet-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: alb, to: nat-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: alb, to: route-table, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: alb, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: alb, to: security-group, value: valid, mechanism: "sg-attach", note: "required for an application load balancer" }
  - { from: alb, to: ec2, value: valid, mechanism: "listener-target", note: "instance target group; the platform adds the ingress rule from the ALB's group" }
  - { from: alb, to: lambda, value: conditional, mechanism: "listener-target", note: "lambda target group; needs aws_lambda_permission for elasticloadbalancing.amazonaws.com; no VPC involved" }
  - { from: alb, to: ecs, value: conditional, mechanism: "listener-target", note: "Fargate needs an ip target group; the service names the container and port" }
  - { from: alb, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: alb, to: s3, value: conditional, mechanism: "resource-policy", note: "access logs only; the bucket needs a statement for the log delivery principal" }
  - { from: alb, to: rds, value: invalid, mechanism: "-", note: "a load balancer forwards to target groups, never to a database" }
  - { from: alb, to: alb, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: alb, to: route53, value: invalid, mechanism: "-", note: "direction: dns-alias is drawn from route53 to alb" }
  - { from: alb, to: cloudfront, value: invalid, mechanism: "-", note: "direction: origin is drawn from cloudfront to alb" }
  - { from: alb, to: acm, value: invalid, mechanism: "-", note: "direction: cert-attach is drawn from acm to alb" }
  - { from: alb, to: iam-role, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: alb, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: vpc, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: subnet, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: internet-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: nat-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: route-table, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: security-group, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: ec2, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: lambda, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: ecs, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: s3, value: invalid, mechanism: "-", note: "alias to an S3 website endpoint is not specified in this version; serve a static site through CloudFront instead" }
  - { from: route53, to: rds, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: alb, value: valid, mechanism: "dns-alias", note: "alias A record; evaluate_target_health is required" }
  - { from: route53, to: route53, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: route53, to: cloudfront, value: conditional, mechanism: "dns-alias", note: "public zone; the distribution must list the name in aliases with a covering certificate" }
  - { from: route53, to: acm, value: invalid, mechanism: "-", note: "direction: cert-validation is drawn from acm to route53" }
  - { from: route53, to: iam-role, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: route53, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: vpc, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: subnet, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: internet-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: nat-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: route-table, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: security-group, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: ec2, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: lambda, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: ecs, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: s3, value: valid, mechanism: "origin", note: "regular endpoint with origin access control; the platform adds the bucket policy statement" }
  - { from: cloudfront, to: rds, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: alb, value: conditional, mechanism: "origin", note: "the ALB must be internet-facing; with HTTPS its certificate must match the origin name" }
  - { from: cloudfront, to: route53, value: invalid, mechanism: "-", note: "direction: dns-alias is drawn from route53 to cloudfront" }
  - { from: cloudfront, to: cloudfront, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: cloudfront, to: acm, value: invalid, mechanism: "-", note: "direction: cert-attach is drawn from acm to cloudfront" }
  - { from: cloudfront, to: iam-role, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: cloudfront, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: vpc, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: subnet, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: internet-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: nat-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: route-table, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: security-group, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: ec2, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: lambda, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: ecs, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: rds, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: alb, value: conditional, mechanism: "cert-attach", note: "same Region as the load balancer (unverified); must cover every served name" }
  - { from: acm, to: route53, value: valid, mechanism: "cert-validation", note: "derived: one CNAME per distinct validation name; the zone must be delegated" }
  - { from: acm, to: cloudfront, value: conditional, mechanism: "cert-attach", note: "the certificate must be in us-east-1; needs a provider alias" }
  - { from: acm, to: acm, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: acm, to: iam-role, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: acm, to: iam-policy, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-role, to: vpc, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-role, to: subnet, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-role, to: internet-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-role, to: nat-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-role, to: route-table, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-role, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-role, to: security-group, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-role, to: ec2, value: valid, mechanism: "assume-role", note: "through an instance profile; trust principal ec2.amazonaws.com" }
  - { from: iam-role, to: lambda, value: valid, mechanism: "assume-role", note: "execution role; required; trust principal lambda.amazonaws.com" }
  - { from: iam-role, to: ecs, value: valid, mechanism: "assume-role", note: "task role and task execution role are separate slots; trust principal ecs-tasks.amazonaws.com" }
  - { from: iam-role, to: ecr, value: valid, mechanism: "grant", note: "levels pull and push; image pulls by ECS and Lambda need no explicit grant" }
  - { from: iam-role, to: s3, value: valid, mechanism: "grant", note: "same account needs only the identity grant; levels read and readwrite" }
  - { from: iam-role, to: rds, value: conditional, mechanism: "assume-role", note: "monitoring role (assume-role) or IAM database authentication (grant, unverified); both need the condition stated" }
  - { from: iam-role, to: alb, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-role, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-role, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-role, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-role, to: iam-role, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
  - { from: iam-role, to: iam-policy, value: valid, mechanism: "grant", note: "a role holds managed, customer managed and inline policies; attachment is a separate resource, never inline on the role" }
  - { from: iam-policy, to: vpc, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: subnet, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: internet-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: nat-gateway, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: route-table, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: vpc-endpoint-s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: security-group, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: ec2, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: lambda, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: ecs, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: ecr, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: s3, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: rds, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: alb, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: route53, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: cloudfront, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: acm, value: none, mechanism: "-", note: "AWS has no direct relationship between them in this scope" }
  - { from: iam-policy, to: iam-role, value: invalid, mechanism: "-", note: "direction: grant is drawn from iam-role to iam-policy" }
  - { from: iam-policy, to: iam-policy, value: none, mechanism: "-", note: "a resource of this kind has no relationship to another of the same kind" }
---

# Service relation matrix

Every ordered pair of the 19 Tier 1 services has exactly one value (see [00-conventions](../00-conventions.md#8-matrix-cells)).
The list in the front matter is the source of truth; the grid below is a view of it.

A cell reads **from the row service to the column service**, in the direction the mechanism is drawn or derived
(see [00-mechanisms](00-mechanisms.md)). The opposite cell of a directed mechanism is `invalid`: the connection exists, but
only one way round, so a design tool must not offer the reverse.

`V` valid, `C` conditional, `X` invalid, `-` none.

| from \ to | vpc | subnet | internet-gateway | nat-gateway | route-table | vpc-endpoint-s3 | security-group | ec2 | lambda | ecs | ecr | s3 | rds | alb | route53 | cloudfront | acm | iam-role | iam-policy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **vpc** | - | V | V | C | V | V | V | - | - | - | - | - | - | - | - | - | - | - | - |
| **subnet** | X | - | - | X | V | - | - | V | C | V | - | - | C | C | - | - | - | - | - |
| **internet-gateway** | V | - | - | - | X | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| **nat-gateway** | X | C | - | - | X | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| **route-table** | X | V | V | V | - | V | - | - | - | - | - | - | - | - | - | - | - | - | - |
| **vpc-endpoint-s3** | X | - | - | - | X | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| **security-group** | X | - | - | - | - | - | V | V | C | V | - | - | V | V | - | - | - | - | - |
| **ec2** | - | X | - | - | - | - | V | V | X | V | - | - | V | X | - | - | - | X | - |
| **lambda** | - | X | - | - | - | - | C | C | - | C | X | - | C | X | - | - | - | X | - |
| **ecs** | - | X | - | - | - | - | V | V | X | V | X | - | V | X | - | - | - | X | - |
| **ecr** | - | - | - | - | - | - | - | - | C | V | - | - | - | - | - | - | - | X | - |
| **s3** | - | - | - | - | - | - | - | - | - | - | - | - | - | X | - | X | - | X | - |
| **rds** | - | C | - | - | - | - | V | X | X | X | - | - | - | - | - | - | - | X | - |
| **alb** | - | X | - | - | - | - | V | V | C | C | - | C | X | - | X | X | X | - | - |
| **route53** | - | - | - | - | - | - | - | - | - | - | - | X | - | V | - | C | X | - | - |
| **cloudfront** | - | - | - | - | - | - | - | - | - | - | - | V | - | C | X | - | X | - | - |
| **acm** | - | - | - | - | - | - | - | - | - | - | - | - | - | C | V | C | - | - | - |
| **iam-role** | - | - | - | - | - | - | - | V | V | V | V | V | C | - | - | - | - | - | V |
| **iam-policy** | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | X | - |

## Reading the values

- `valid`: allowed without a condition beyond the shared rules (same VPC, explicit security group).
- `conditional`: allowed when the stated condition holds; the rule that checks it is named in the mechanism file.
- `invalid`: either the reverse of a directed mechanism or a pair the spec rules out on purpose. The note says which.
- `none`: AWS has no direct relationship in this scope. Indirect effects are still derived (for example an instance
  reaches the internet through a route table and a NAT gateway; see [egress-path](egress-path.md)).

## Things the matrix makes visible

1. **No workload connects to S3 or ECR directly.** EC2, Lambda and ECS reach S3 only through an
   `iam-role` ([assume-role](assume-role.md) then [grant](grant.md)); the cells `ec2 -> s3`, `lambda -> s3` and `ecs -> s3` are `none`.
2. **Every internet path is derived.** The pairs between workloads and route tables, gateways, NAT gateways and the S3 endpoint are `none`;
   the verdict comes from [egress-path](egress-path.md), which reports `internet_egress` and `s3_path` separately.
3. **`iam-role -> rds` carries two mechanisms** (monitoring role and database authentication). They share one cell; the
   registry rows in [assume-role](assume-role.md) and [grant](grant.md) hold the detail.
4. **`route53 -> s3` is `invalid` in this version.** The dns-alias file covers ALB and CloudFront only; an alias to an S3
   website endpoint is not specified. Static sites go through CloudFront.
5. **`alb -> s3`** (access logs) is a resource-policy relationship, not a role grant; the principal is the log delivery service.
6. **Lambda is the odd one out.** It joins a VPC, a security group, a subnet and `network-access` only when attached to a VPC;
   `alb -> lambda` works without any VPC.
7. **No pair marks ACM, Route 53 or CloudFront as VPC members.** They are global or regional and sit outside the network.
8. **The S3 endpoint is a route target, not a peer of S3.** `route-table -> vpc-endpoint-s3` is the only drawn line; `vpc-endpoint-s3 -> s3` is `none`
   because the endpoint covers every S3 bucket in its Region (its policy may name buckets, but that is a property, not a connection).
   The egress rule to the S3 prefix list is generated from the association, so `security-group -> vpc-endpoint-s3` is also `none`.

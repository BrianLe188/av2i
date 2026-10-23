---
id: isolated-private-app
title: { vi: "Ứng dụng cô lập, không có đường ra Internet", en: "Isolated private application with no internet path" }
services: [vpc, subnet, route-table, vpc-endpoint-s3, security-group, ec2, ecs, ecr, lambda, rds, s3, iam-role]
nodes:
  - { id: vpc, service: vpc, props: { cidr_block: "10.3.0.0/16" } }
  - { id: priv-a, service: subnet, props: { availability_zone: az-a } }
  - { id: priv-b, service: subnet, props: { availability_zone: az-b } }
  - { id: rt, service: route-table, props: { routes: "local only" } }
  - { id: s3-endpoint, service: vpc-endpoint-s3, props: { policy: "bucket data only" } }
  - { id: sg-app, service: security-group }
  - { id: sg-db, service: security-group }
  - { id: worker, service: ecs, props: { part: service, launch_type: FARGATE, assign_public_ip: false } }
  - { id: repo, service: ecr }
  - { id: batch, service: ec2 }
  - { id: fn, service: lambda, props: { vpc_config: [priv-a, priv-b] } }
  - { id: db, service: rds }
  - { id: data, service: s3 }
  - { id: role, service: iam-role }
connections:
  - { from: rt, to: priv-a, mechanism: route-association, kind: drawn }
  - { from: rt, to: priv-b, mechanism: route-association, kind: drawn }
  - { from: rt, to: s3-endpoint, mechanism: route, kind: drawn, note: "the one path out: S3 in this Region" }
  - { from: repo, to: worker, mechanism: image-source, kind: drawn }
  - { from: worker, to: db, mechanism: network-access, kind: drawn }
  - { from: batch, to: db, mechanism: network-access, kind: drawn }
  - { from: fn, to: db, mechanism: network-access, kind: drawn }
  - { from: role, to: batch, mechanism: assume-role, kind: drawn }
  - { from: role, to: data, mechanism: grant, kind: drawn }
expect:
  errors: []
  findings: [VAL-032, VAL-042]
variants:
  - { id: no-endpoint, change: "remove s3-endpoint", fires: [VAL-070, VAL-032, VAL-042], severity: warning, note: "batch can no longer read data" }
  - { id: add-nat, change: "add public subnets, an internet gateway, a NAT gateway and a 0.0.0.0/0 route to it", fires: [], severity: info, note: "VAL-032 and VAL-042 stop firing; egress becomes via_nat; the endpoint stays useful for S3 cost" }
  - { id: data-bucket-other-region, change: "data is in another Region", fires: [VAL-126, VAL-070], severity: warning }
  - { id: wide-endpoint-policy, change: "endpoint policy left at the default", fires: [SEC-043], severity: info }
  - { id: add-igw-only, change: "an internet gateway and a default route in a private subnet, no public addresses", fires: [VAL-032], severity: info, note: "a route to an internet gateway alone gives no egress without a public address" }
  - { id: public-ip-no-igw, change: "assign_public_ip true with no internet gateway", fires: [VAL-045, SEC-011], severity: warning }
  - { id: ec2-public-ip-no-route, change: "associate_public_ip_address true in a private subnet", fires: [VAL-031], severity: warning }
  - { id: db-publicly-accessible, change: "publicly_accessible true", fires: [VAL-062, SEC-017], severity: warning }
---

# Isolated private application

No internet gateway, no NAT gateway, no public address. Every workload reaches only what lives in the VPC. The scenario
exists to show how the platform reports the consequences rather than failing silently.

## What the platform derives

- [egress-path](../relations/egress-path.md) gives `none` for `worker`, `batch` and `fn`. VAL-032 (info) says so for every
  workload.
- `worker` cannot pull `repo`: with no NAT and no ECR interface endpoint it stays `PENDING` (VAL-042, warning).
- `batch` reads `data` through `role`, and the request reaches S3 through `s3-endpoint` (`s3_path` is true), so VAL-070 stays quiet.
  The endpoint does not give internet access: `internet_egress` stays false.
- The Lambda execution role still needs the VPC permission policy; isolation does not remove that need (VAL-111).

## What is not modelled

The S3 gateway endpoint (Tier 1, D-029) covers S3 only. The other usual answer to this layout is an interface endpoint for ECR
and the logs service; interface endpoints are Tier 2, so the platform cannot draw them and `worker` still cannot pull `repo`
(VAL-042). VAL-042 already mentions an ECR interface endpoint as a way out, but the design has no node that can satisfy that
clause.

## Edge cases this scenario exercises

| Case | Where it is decided |
|---|---|
| A route to an internet gateway does not give a private instance egress | [egress-path](../relations/egress-path.md) |
| A public address is useless without a route to an internet gateway | VAL-031, VAL-045 |
| Lambda attached to a VPC loses internet access | VAL-032, VAL-038 |
| A database in subnets with no internet path | VAL-062 |
| S3 reachable while the internet is not | [vpc-endpoint-s3](../services/vpc-endpoint-s3.md), `s3_path` in [egress-path](../relations/egress-path.md) |

---
id: serverless-api
title: { vi: "API serverless: ALB, Lambda, S3, RDS", en: "Serverless API: ALB, Lambda, S3, RDS" }
services: [vpc, subnet, internet-gateway, nat-gateway, route-table, vpc-endpoint-s3, security-group, lambda, ecr, alb, rds, s3, iam-role]
nodes:
  - { id: vpc, service: vpc, props: { cidr_block: "10.1.0.0/16" } }
  - { id: pub-a, service: subnet, props: { availability_zone: az-a } }
  - { id: pub-b, service: subnet, props: { availability_zone: az-b } }
  - { id: priv-a, service: subnet, props: { availability_zone: az-a } }
  - { id: priv-b, service: subnet, props: { availability_zone: az-b } }
  - { id: rt-priv, service: route-table, props: { routes: "local only" } }
  - { id: s3-endpoint, service: vpc-endpoint-s3 }
  - { id: alb, service: alb, props: { internal: false } }
  - { id: sg-alb, service: security-group }
  - { id: edge-fn, service: lambda, props: { package_type: Zip, vpc_config: none, note: "public handler, no VPC" } }
  - { id: data-fn, service: lambda, props: { package_type: Image, architectures: [x86_64], vpc_config: [priv-a, priv-b] } }
  - { id: repo, service: ecr }
  - { id: sg-fn, service: security-group }
  - { id: sg-db, service: security-group }
  - { id: db, service: rds, props: { engine: postgres } }
  - { id: uploads, service: s3 }
  - { id: edge-role, service: iam-role }
  - { id: data-role, service: iam-role }
connections:
  - { from: rt-priv, to: priv-a, mechanism: route-association, kind: drawn }
  - { from: rt-priv, to: priv-b, mechanism: route-association, kind: drawn }
  - { from: rt-priv, to: s3-endpoint, mechanism: route, kind: drawn, note: "data-fn reaches S3 with no NAT gateway" }
  - { from: alb, to: edge-fn, mechanism: listener-target, kind: drawn, note: "lambda target group; aws_lambda_permission generated" }
  - { from: sg-alb, to: alb, mechanism: sg-attach, kind: drawn }
  - { from: alb, to: data-fn, mechanism: listener-target, kind: drawn, note: "a second path; same rules" }
  - { from: repo, to: data-fn, mechanism: image-source, kind: drawn }
  - { from: sg-fn, to: data-fn, mechanism: sg-attach, kind: drawn }
  - { from: data-fn, to: db, mechanism: network-access, kind: drawn, note: "port 5432" }
  - { from: sg-db, to: sg-fn, mechanism: sg-reference, kind: generated }
  - { from: edge-role, to: edge-fn, mechanism: assume-role, kind: derived, note: "required execution role, AWSLambdaBasicExecutionRole (D-025)" }
  - { from: data-role, to: data-fn, mechanism: assume-role, kind: derived, note: "adds AWSLambdaVPCAccessExecutionRole because vpc_config is set" }
  - { from: data-role, to: uploads, mechanism: grant, kind: drawn, note: "level readwrite" }
expect:
  errors: []
  findings: [SEC-008, SEC-013, SEC-019, SEC-028, SEC-043, VAL-032]
variants:
  - { id: no-endpoint, change: "remove s3-endpoint from rt-priv", fires: [VAL-070], severity: warning, note: "data-fn can reach the database but not S3" }
  - { id: vpc-no-nat, change: "data-fn code calls an external HTTPS API", fires: [VAL-032], severity: info, note: "already reported on the base design; the call times out because the endpoint carries only S3" }
  - { id: public-subnet-attach, change: "data-fn attached to pub-a and pub-b", fires: [VAL-038], severity: warning }
  - { id: one-subnet, change: "data-fn attached only to priv-a", fires: [VAL-037], severity: warning }
  - { id: subnets-no-sg, change: "data-fn has subnets but no security group", fires: [VAL-036, VAL-029], severity: error }
  - { id: no-vpc-to-db, change: "edge-fn is connected to db by network-access", fires: [VAL-049], severity: error }
  - { id: missing-vpc-policy, change: "data-role lacks AWSLambdaVPCAccessExecutionRole", fires: [VAL-111], severity: error }
  - { id: no-execution-role, change: "a function with no role", fires: [VAL-110], severity: error }
  - { id: image-other-region, change: "repo in another Region", fires: [VAL-035], severity: error }
  - { id: image-two-architectures, change: "multi-architecture manifest", fires: [VAL-035], severity: error }
  - { id: dedicated-tenancy, change: "the VPC uses dedicated tenancy", fires: [VAL-039], severity: error }
  - { id: no-invoke-permission, change: "the ALB lambda permission removed", fires: [VAL-081], severity: error }
  - { id: bad-timeout, change: "timeout 1200 seconds", fires: [VAL-034], severity: error }
  - { id: shared-role, change: "both functions use one role", fires: [SEC-041], severity: info }
  - { id: wildcard-grant, change: "raw JSON policy with s3:* on *", fires: [SEC-036], severity: error }
  - { id: admin-role, change: "AdministratorAccess attached", fires: [SEC-035], severity: error }
---

# Serverless API

Two functions behind one load balancer. `edge-fn` stays outside any VPC and has internet access by default. `data-fn` joins
the VPC to reach the database and loses that access unless the VPC supplies a NAT path.

## What the platform derives or generates

- Execution roles are **required roles** (D-025): created automatically, shown as derived, replaceable. `data-role` also gets
  the VPC permissions because `vpc_config` is set (VAL-111).
- `aws_lambda_permission` for `elasticloadbalancing.amazonaws.com` is generated by `listener-target`
  ([listener-target](../relations/listener-target.md), VAL-081); the permission lives on the function, not on the role.
- The network path from `data-fn` to S3 is the S3 gateway endpoint on `rt-priv`. It carries nothing else, so `data-fn` still
  has no internet and VAL-032 is reported on the base design.
- The S3 access of `data-fn` is a `grant` on `data-role`. There is no bucket policy: same-account access needs only the
  identity side ([resource-policy](../relations/resource-policy.md)).

## Edge cases this scenario exercises

| Case | Where it is decided |
|---|---|
| A function outside the VPC cannot reach the database | [network-access](../relations/network-access.md), VAL-049 |
| S3 from a VPC function with no NAT gateway | [vpc-endpoint-s3](../services/vpc-endpoint-s3.md), VAL-070 |
| Joining a VPC removes default internet access | [egress-path](../relations/egress-path.md), VAL-032, VAL-038 |
| The package type of an existing function cannot change | [lambda](../services/lambda.md) (a change is a replacement) |
| An idle VPC function becomes `Inactive` after 14 days | [lambda](../services/lambda.md), behaviour only; no rule |
| Role deleted before the function leaves the VPC strands interfaces | [lambda](../services/lambda.md), pitfalls |

## Open points

None specific. `edge-fn` has no VPC, so [egress-path](../relations/egress-path.md) reports it as not applicable (its internet
access is Lambda's own, row 6 of that file), and `data-fn` follows the subnet rules.

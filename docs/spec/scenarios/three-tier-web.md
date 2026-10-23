---
id: three-tier-web
title: { vi: "Web 3 tầng: ALB, EC2, RDS", en: "Three-tier web: ALB, EC2, RDS" }
services: [vpc, subnet, internet-gateway, nat-gateway, route-table, vpc-endpoint-s3, security-group, ec2, rds, alb, route53, acm, iam-role, s3]
nodes:
  - { id: vpc, service: vpc, props: { cidr_block: "10.0.0.0/16", enable_dns_support: true, enable_dns_hostnames: true } }
  - { id: igw, service: internet-gateway }
  - { id: pub-a, service: subnet, props: { cidr_block: "10.0.0.0/24", availability_zone: az-a } }
  - { id: pub-b, service: subnet, props: { cidr_block: "10.0.1.0/24", availability_zone: az-b } }
  - { id: app-a, service: subnet, props: { cidr_block: "10.0.10.0/24", availability_zone: az-a } }
  - { id: app-b, service: subnet, props: { cidr_block: "10.0.11.0/24", availability_zone: az-b } }
  - { id: db-a, service: subnet, props: { cidr_block: "10.0.20.0/24", availability_zone: az-a } }
  - { id: db-b, service: subnet, props: { cidr_block: "10.0.21.0/24", availability_zone: az-b } }
  - { id: nat-a, service: nat-gateway, props: { mode: zonal, connectivity_type: public } }
  - { id: nat-b, service: nat-gateway, props: { mode: zonal, connectivity_type: public } }
  - { id: rt-public, service: route-table }
  - { id: rt-app-a, service: route-table }
  - { id: rt-app-b, service: route-table }
  - { id: rt-db, service: route-table }
  - { id: s3-endpoint, service: vpc-endpoint-s3, props: { policy: default } }
  - { id: sg-alb, service: security-group }
  - { id: sg-app, service: security-group }
  - { id: sg-db, service: security-group }
  - { id: alb, service: alb, props: { internal: false, load_balancer_type: application } }
  - { id: app, service: ec2, props: { count: 2, associate_public_ip_address: false } }
  - { id: db, service: rds, props: { engine: postgres, multi_az: true, publicly_accessible: false, manage_master_user_password: true } }
  - { id: zone, service: route53, props: { zone: public } }
  - { id: cert, service: acm, props: { validation_method: DNS } }
  - { id: app-role, service: iam-role }
  - { id: assets, service: s3 }
connections:
  - { from: vpc, to: igw, mechanism: igw-attach, kind: derived }
  - { from: rt-public, to: igw, mechanism: route, kind: drawn, note: "0.0.0.0/0" }
  - { from: rt-public, to: pub-a, mechanism: route-association, kind: drawn }
  - { from: rt-public, to: pub-b, mechanism: route-association, kind: drawn }
  - { from: nat-a, to: pub-a, mechanism: nat-placement, kind: derived }
  - { from: nat-b, to: pub-b, mechanism: nat-placement, kind: derived }
  - { from: rt-app-a, to: nat-a, mechanism: route, kind: drawn, note: "same AZ as the gateway (VAL-013)" }
  - { from: rt-app-b, to: nat-b, mechanism: route, kind: drawn }
  - { from: rt-app-a, to: s3-endpoint, mechanism: route, kind: drawn, note: "association; S3 traffic skips the NAT gateway" }
  - { from: rt-app-b, to: s3-endpoint, mechanism: route, kind: drawn }
  - { from: rt-app-a, to: app-a, mechanism: route-association, kind: drawn }
  - { from: rt-app-b, to: app-b, mechanism: route-association, kind: drawn }
  - { from: rt-db, to: db-a, mechanism: route-association, kind: drawn, note: "local route only: no internet path" }
  - { from: rt-db, to: db-b, mechanism: route-association, kind: drawn }
  - { from: sg-alb, to: alb, mechanism: sg-attach, kind: drawn }
  - { from: sg-app, to: app, mechanism: sg-attach, kind: drawn }
  - { from: sg-db, to: db, mechanism: sg-attach, kind: drawn }
  - { from: alb, to: pub-a, mechanism: containment, kind: drawn, note: "two subnets in two AZs" }
  - { from: alb, to: app, mechanism: listener-target, kind: drawn }
  - { from: app, to: db, mechanism: network-access, kind: drawn, note: "port 5432" }
  - { from: sg-app, to: sg-alb, mechanism: sg-reference, kind: generated, note: "app ingress from the load balancer group, target and health check port" }
  - { from: sg-db, to: sg-app, mechanism: sg-reference, kind: generated, note: "database ingress from the app group on 5432" }
  - { from: db, to: db-a, mechanism: db-subnet-group, kind: drawn, note: "db-a and db-b" }
  - { from: zone, to: alb, mechanism: dns-alias, kind: drawn }
  - { from: cert, to: alb, mechanism: cert-attach, kind: drawn }
  - { from: cert, to: zone, mechanism: cert-validation, kind: derived }
  - { from: app-role, to: app, mechanism: assume-role, kind: drawn, note: "instance profile generated" }
  - { from: app-role, to: assets, mechanism: grant, kind: drawn, note: "level read" }
expect:
  errors: []
  findings: [SEC-019, SEC-026, SEC-027, SEC-028, SEC-013, SEC-043]
variants:
  - { id: no-nat-route, change: "remove the route from rt-app-a to nat-a", fires: [VAL-032], severity: info }
  - { id: nat-wrong-az, change: "rt-app-a routes to nat-b", fires: [VAL-013], severity: warning }
  - { id: nat-in-private-subnet, change: "nat-a placed in app-a", fires: [VAL-012], severity: warning }
  - { id: alb-one-subnet, change: "the ALB uses only pub-a", fires: [VAL-071], severity: error }
  - { id: alb-private-subnets, change: "internet-facing ALB placed in app-a and app-b", fires: [VAL-074], severity: warning }
  - { id: db-one-az, change: "db subnet group holds only db-a", fires: [VAL-058, VAL-067], severity: error }
  - { id: db-open-port, change: "sg-db allows 5432 from 0.0.0.0/0", fires: [SEC-023], severity: error }
  - { id: db-public, change: "db has publicly_accessible true", fires: [SEC-017, VAL-062], severity: warning }
  - { id: ssh-open, change: "sg-app allows 22 from 0.0.0.0/0", fires: [SEC-002], severity: warning }
  - { id: no-security-group, change: "app has no security group", fires: [VAL-029], severity: error }
  - { id: http-only, change: "no HTTPS listener, the HTTP listener forwards", fires: [SEC-024], severity: warning }
  - { id: cert-not-covering, change: "certificate covers example.com but the alias is www.example.com", fires: [VAL-102], severity: error }
  - { id: role-wrong-trust, change: "the role's trust policy names lambda.amazonaws.com", fires: [VAL-105], severity: error }
  - { id: role-unused, change: "app-role connected to nothing", fires: [VAL-106], severity: warning }
  - { id: endpoint-removed, change: "remove s3-endpoint and the NAT routes", fires: [VAL-070, VAL-032], severity: warning, note: "app reads S3 with no path" }
  - { id: endpoint-wrong-vpc, change: "rt-app-a belongs to another VPC but is associated with s3-endpoint", fires: [VAL-122], severity: error }
  - { id: two-endpoints-one-table, change: "a second S3 endpoint associated with rt-app-a", fires: [VAL-122], severity: error }
  - { id: bucket-other-region, change: "assets is in another Region and the NAT routes are removed", fires: [VAL-126, VAL-070, VAL-032], severity: warning }
  - { id: endpoint-region-mismatch, change: "service_name names another Region", fires: [VAL-123], severity: error }
  - { id: endpoint-policy-principal, change: "endpoint policy with Principal AWS account id", fires: [VAL-125], severity: error }
  - { id: restricted-egress, change: "sg-app egress allows only the database port, S3 endpoint kept", fires: [VAL-127], severity: warning }
  - { id: source-ip-condition, change: "a bucket policy statement on assets uses aws:SourceIp", fires: [SEC-044], severity: warning }
  - { id: dns-off, change: "enable_dns_hostnames false", fires: [VAL-124], severity: warning }
  - { id: direct-edge-to-s3, change: "a connection drawn from app to assets with no role", fires: [], severity: error, note: "rejected by the matrix: ec2 to s3 is none; no rule ID because the edge cannot be created" }
---

# Three-tier web

The classic layout: an internet-facing load balancer in public subnets, application servers in private subnets that
reach the internet through a NAT gateway in their own AZ, and a Multi-AZ database in private subnets that have no
internet route at all.

## What the platform derives or generates

- `igw-attach` and `nat-placement` come from nesting; the user draws no line for them.
- Public or private is read from the route tables, not from the subnet ([route-association](../relations/route-association.md)).
  `pub-*` are public (route to `igw`), `app-*` are private with egress `via_nat`, `db-*` are private with egress `none`.
- The `sg-reference` rules are generated from the drawn `listener-target` and `network-access` lines. The database group
  allows only the app group on 5432; the app group allows only the load balancer group.
- The Elastic IPs for the two NAT gateways and the instance profile for `app-role` are generated.
- `cert-validation` adds one CNAME per distinct validation name to the zone.

## Edge cases this scenario exercises

| Case | Where it is decided |
|---|---|
| One NAT gateway per AZ, each AZ's table routes to its own gateway | [nat-placement](../relations/nat-placement.md), VAL-013 |
| A subnet that has no internet route at all (database tier) | [egress-path](../relations/egress-path.md) result `none` |
| Load balancer needs two subnets in two AZs | [containment](../relations/containment.md), VAL-071 |
| Instance reads S3 only through a role | [assume-role](../relations/assume-role.md), [grant](../relations/grant.md) |
| Database password never enters the design | D-017, `manage_master_user_password` |
| S3 reached through an endpoint route instead of the NAT gateway | [route](../relations/route.md), [vpc-endpoint-s3](../services/vpc-endpoint-s3.md), VAL-070 |

## Variants

Each variant in the front matter mutates the base design and lists the rules that must fire. The last variant checks the
matrix rather than a rule: the connection cannot be created.

## Open points

S3 traffic from `app` takes the endpoint route, not the NAT gateway, so it costs no NAT data charge; other traffic (package
updates, external APIs) still uses the NAT gateway. The endpoint policy is the default full access, which SEC-043 reports
as an info finding (D-029).

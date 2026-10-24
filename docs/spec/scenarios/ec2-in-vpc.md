---
id: ec2-in-vpc
title: { vi: "EC2 trong VPC: subnet public và private, NAT, S3 endpoint", en: "EC2 in a VPC: public and private subnets, NAT, S3 endpoint" }
services: [vpc, subnet, internet-gateway, nat-gateway, elastic-ip, route-table, vpc-endpoint-s3, security-group, ec2]
executable: true
design:
  schema: 1
  name: ec2-in-vpc
  settings: { region: ap-southeast-1 }
  nodes:
    - { key: vpc, label: "Main", service: vpc, props: { cidr_block: "10.0.0.0/16", enable_dns_support: true, enable_dns_hostnames: true } }
    - { key: igw, label: "Internet gateway", service: internet-gateway, parent: vpc, props: {} }
    - { key: pub_a, label: "Public A", service: subnet, parent: vpc, props: { cidr_block: "10.0.0.0/24", availability_zone: ap-southeast-1a } }
    - { key: app_a, label: "App A", service: subnet, parent: vpc, props: { cidr_block: "10.0.10.0/24", availability_zone: ap-southeast-1a } }
    - { key: nat_a, label: "NAT A", service: nat-gateway, parent: pub_a, props: { availability_mode: zonal, connectivity_type: public } }
    - { key: rt_public, label: "Public routes", service: route-table, parent: vpc, props: {} }
    - { key: rt_app, label: "App routes", service: route-table, parent: vpc, props: {} }
    - { key: s3ep, label: "S3 endpoint", service: vpc-endpoint-s3, parent: vpc, props: { policy: { Version: "2012-10-17", Statement: [{ Effect: Allow, Principal: "*", Action: ["s3:GetObject"], Resource: ["arn:aws:s3:::example-bucket/*"] }] } } }
    - key: sg_app
      label: "app-sg"
      service: security-group
      parent: vpc
      props:
        name: app-sg
        description: "Application tier"
        ingress_rules:
          - { ip_protocol: tcp, from_port: 22, to_port: 22, cidr_ipv4: "10.0.0.0/16", description: "ssh from the VPC" }
    - key: app
      label: "App"
      service: ec2
      parent: app_a
      props:
        ami: ami-0123456789abcdef0
        instance_type: t3.micro
        metadata_options: { http_tokens: required }
        root_block_device: { encrypted: true }
  edges:
    - { id: e_rt_public_igw, mechanism: route, from: rt_public, to: igw, props: { destination_cidr_block: "0.0.0.0/0" } }
    - { id: e_rt_public_pub, mechanism: route-association, from: rt_public, to: pub_a }
    - { id: e_rt_app_nat, mechanism: route, from: rt_app, to: nat_a, props: { destination_cidr_block: "0.0.0.0/0" } }
    - { id: e_rt_app_s3, mechanism: route, from: rt_app, to: s3ep }
    - { id: e_rt_app_app, mechanism: route-association, from: rt_app, to: app_a }
    - { id: e_sg_app, mechanism: sg-attach, from: sg_app, to: app }
expect:
  errors: []
  findings: []
patch_ops:
  - "set: { op: set, node: <key>, path: <dotted path under the node>, value: <any> }"
  - "unset: { op: unset, node: <key>, path: <dotted path> }"
  - "add-node: { op: add-node, node: <Node> }"
  - "remove-node: { op: remove-node, key: <key> } (also removes its edges)"
  - "add-edge: { op: add-edge, edge: <Edge> }"
  - "remove-edge: { op: remove-edge, mechanism: <id>, from: <key>, to: <key> }"
variants:
  - { id: vpc-cidr-too-big, change: "vpc cidr is /15", patch: [{ op: set, node: vpc, path: props.cidr_block, value: "10.0.0.0/15" }], fires: [VAL-001], severity: error }
  - { id: vpc-cidr-loopback, change: "vpc cidr is in 127.0.0.0/8", patch: [{ op: set, node: vpc, path: props.cidr_block, value: "127.0.0.0/16" }], fires: [VAL-002, VAL-004], severity: error }
  - { id: subnet-too-small, change: "app_a is a /29", patch: [{ op: set, node: app_a, path: props.cidr_block, value: "10.0.10.0/29" }], fires: [VAL-003], severity: error }
  - { id: subnet-outside-vpc, change: "app_a cidr is outside the VPC", patch: [{ op: set, node: app_a, path: props.cidr_block, value: "10.1.0.0/24" }], fires: [VAL-004], severity: error }
  - { id: subnets-overlap, change: "app_a overlaps pub_a", patch: [{ op: set, node: app_a, path: props.cidr_block, value: "10.0.0.128/25" }], fires: [VAL-005], severity: error }
  - { id: subnet-no-az, change: "app_a has no availability zone", patch: [{ op: unset, node: app_a, path: props.availability_zone }], fires: [VAL-006], severity: warning }
  - { id: two-igws, change: "a second internet gateway in the VPC", patch: [{ op: add-node, node: { key: igw2, label: "Second", service: internet-gateway, parent: vpc, props: {} } }], fires: [VAL-007], severity: error }
  - { id: igw-detached, change: "the internet gateway is outside any VPC", patch: [{ op: set, node: igw, path: parent, value: null }], fires: [VAL-008, VAL-010, VAL-012, VAL-032], severity: error }
  - { id: duplicate-route, change: "a second route to the same destination", patch: [{ op: add-edge, edge: { id: e_dup, mechanism: route, from: rt_app, to: igw, props: { destination_cidr_block: "0.0.0.0/0" } } }], fires: [VAL-016], severity: error }
  - { id: reserved-destination, change: "a route to 169.254.168.0/24", patch: [{ op: add-edge, edge: { id: e_res, mechanism: route, from: rt_app, to: nat_a, props: { destination_cidr_block: "169.254.168.0/24" } } }], fires: [VAL-017], severity: error }
  - { id: nat-in-private-subnet, change: "the NAT gateway sits in app_a", patch: [{ op: set, node: nat_a, path: parent, value: app_a }], fires: [VAL-012, VAL-028, VAL-032], severity: error }
  - { id: nat-other-az, change: "a subnet in another AZ uses the table that routes to the NAT gateway", patch: [{ op: add-node, node: { key: app_b, label: "App B", service: subnet, parent: vpc, props: { cidr_block: "10.0.11.0/24", availability_zone: ap-southeast-1b } } }, { op: add-edge, edge: { id: e_rt_app_b, mechanism: route-association, from: rt_app, to: app_b } }], fires: [VAL-013], severity: warning }
  - { id: no-nat-route, change: "the app route table has no route to the NAT gateway", patch: [{ op: remove-edge, mechanism: route, from: rt_app, to: nat_a }], fires: [VAL-032], severity: info }
  - { id: no-security-group, change: "the instance has no security group", patch: [{ op: remove-edge, mechanism: sg-attach, from: sg_app, to: app }], fires: [VAL-029, SEC-004], severity: error }
  - { id: ssh-open, change: "ssh from anywhere", patch: [{ op: set, node: sg_app, path: props.ingress_rules, value: [{ ip_protocol: tcp, from_port: 22, to_port: 22, cidr_ipv4: "0.0.0.0/0" }] }], fires: [SEC-002], severity: warning }
  - { id: all-open, change: "all protocols from anywhere", patch: [{ op: set, node: sg_app, path: props.ingress_rules, value: [{ ip_protocol: "-1", cidr_ipv4: "0.0.0.0/0" }] }], fires: [SEC-001, SEC-003], severity: error }
  - { id: wide-port-range, change: "1000 ports from the VPC range", patch: [{ op: set, node: sg_app, path: props.ingress_rules, value: [{ ip_protocol: tcp, from_port: 1000, to_port: 2000, cidr_ipv4: "10.0.0.0/8" }] }], fires: [SEC-003], severity: warning }
  - { id: imds-v1, change: "IMDSv1 accepted", patch: [{ op: set, node: app, path: props.metadata_options.http_tokens, value: optional }], fires: [SEC-006], severity: warning }
  - { id: root-unencrypted, change: "root volume not encrypted", patch: [{ op: set, node: app, path: props.root_block_device.encrypted, value: false }], fires: [SEC-007], severity: warning }
  - { id: no-instance-type, change: "no instance type", patch: [{ op: unset, node: app, path: props.instance_type }], fires: [VAL-030], severity: error }
  - { id: ami-lookup, change: "no AMI: the latest Amazon Linux 2023 image is looked up", patch: [{ op: unset, node: app, path: props.ami }], fires: [], severity: info }
  - { id: ami-lookup-arm, change: "an Ubuntu image for a Graviton instance type", patch: [{ op: unset, node: app, path: props.ami }, { op: set, node: app, path: props.ami_family, value: ubuntu-24-04 }, { op: set, node: app, path: props.instance_type, value: t4g.micro }], fires: [], severity: info }
  - { id: ami-unknown-family, change: "no AMI and an unknown family", patch: [{ op: unset, node: app, path: props.ami }, { op: set, node: app, path: props.ami_family, value: nope }], fires: [VAL-030], severity: error }
  - { id: key-name, change: "an existing key pair", patch: [{ op: set, node: app, path: props.key_name, value: my-key }], fires: [], severity: info }
  - { id: eip-idle, change: "an Elastic IP attached to nothing", patch: [{ op: add-node, node: { key: eip_idle, label: "Idle", service: elastic-ip, props: {} } }], fires: [VAL-128], severity: warning }
  - { id: eip-on-private-instance, change: "an Elastic IP on the instance in the private subnet", patch: [{ op: add-node, node: { key: eip_app, label: "App IP", service: elastic-ip, props: {} } }, { op: add-edge, edge: { id: e_eip_app, mechanism: eip-attach, from: eip_app, to: app } }], fires: [VAL-031], severity: warning }
  - { id: dns-hostnames-off, change: "DNS hostnames off with an S3 endpoint", patch: [{ op: set, node: vpc, path: props.enable_dns_hostnames, value: false }], fires: [VAL-124], severity: warning }
  - { id: s3-endpoint-full-access, change: "the S3 endpoint has no policy", patch: [{ op: unset, node: s3ep, path: props.policy }], fires: [SEC-043], severity: info }
  - { id: s3-endpoint-other-region, change: "the endpoint names the service of another Region", patch: [{ op: set, node: s3ep, path: props.service_name, value: "com.amazonaws.us-east-1.s3" }], fires: [VAL-123], severity: error }
  - { id: sg-name-sg-prefix, change: "the security group name starts with sg-", patch: [{ op: set, node: sg_app, path: props.name, value: sg-app }], fires: [VAL-018], severity: error }
  - { id: sg-description-empty, change: "the security group description is empty", patch: [{ op: set, node: sg_app, path: props.description, value: "" }], fires: [VAL-020], severity: error }
  - { id: sg-name-duplicate, change: "a second group with the same name in another case", patch: [{ op: add-node, node: { key: sg_dup, label: "Dup", service: security-group, parent: vpc, props: { name: APP-SG, description: "Duplicate" } } }], fires: [VAL-019], severity: error }
  - { id: two-s3-endpoints-one-table, change: "a second S3 endpoint on the same route table", patch: [{ op: add-node, node: { key: s3ep2, label: "Second endpoint", service: vpc-endpoint-s3, parent: vpc, props: { policy: { Version: "2012-10-17", Statement: [{ Effect: Allow, Principal: "*", Action: ["s3:GetObject"], Resource: ["arn:aws:s3:::example-bucket/*"] }] } } } }, { op: add-edge, edge: { id: e_s3_2, mechanism: route, from: rt_app, to: s3ep2 } }], fires: [VAL-122], severity: error }
  - { id: s3-endpoint-bad-principal, change: "the endpoint policy names a principal", patch: [{ op: set, node: s3ep, path: props.policy, value: { Version: "2012-10-17", Statement: [{ Effect: Allow, Principal: { AWS: "arn:aws:iam::123456789012:root" }, Action: ["s3:GetObject"], Resource: ["arn:aws:s3:::example-bucket/*"] }] } }], fires: [VAL-125], severity: error }
---

# EC2 in a VPC

The smallest design that exercises the network groups end to end: a public subnet that hosts a NAT gateway, a private subnet
with one instance, an S3 gateway endpoint on the private route table and one security group. It is the first scenario the
engine runs (milestone M1), so it carries its own `design` and variants with executable `patch` lists
([design decisions](../../design/decisions.md), DD-008).

## What the engine derives or generates

- `igw-attach`, `nat-placement` and `containment` come from `parent`.
- An Elastic IP and its `eip-attach` for `nat_a` (D-030), named `eip_nat_a`.
- The managed, rule-less default security group of the VPC (D-006).
- The S3 endpoint association for `rt_app` and the egress rule that reaches the S3 prefix list when the group restricts egress.
- `egress_rules` is absent on `sg_app`, so the engine emits AWS's allow-all egress rule explicitly (see DD-013). An explicit
  empty list would mean no egress.

## Patch operations

The `patch_ops` list in the front matter names the operations. They address nodes by `key`, not by array index, so a patch
survives reordering (decision DD-012 explains why this is not RFC 6902 JSON Patch).

---
id: ec2
title: { vi: "EC2 (máy chủ ảo)", en: "Amazon EC2 instance" }
terraform:
  resources: [aws_instance]
scope: az
placement:
  requires: [vpc, subnet]
  subnet_type: any              # public only if it must be reachable from the internet directly
  min_azs: 1
sources:
  S1: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/instance.html.markdown
  S2: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-instance-addressing.html
  S3: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html
  S4: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-resource-limits.html
  S5: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html
  S6: https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html
properties:
  - key: ami
    type: string
    required: true            # platform choice; the provider allows a launch template instead
    constraints: ["AMI must exist in the instance's Region", "architecture must match instance_type (unverified)"]
    src: [S1]
    status: verified          # requirement verified; the Region and architecture constraints are unverified
  - key: instance_type
    type: string
    required: true            # platform choice; same reason
    force_new: false          # changing it stops and starts the instance (S1)
    src: [S1]
    status: verified
  - key: subnet_id
    type: reference
    ref: subnet
    required: true
    constraints: ["one subnet; fixes the Availability Zone"]
    src: [S1]
    status: verified
  - key: vpc_security_group_ids
    type: list
    ref: security-group
    required: true            # platform rule D-005: at least one explicit group
    constraints: ["use this, not security_groups, in a VPC", "at most 5 per network interface by default"]
    src: [S1, S5]
    status: verified
  - key: associate_public_ip_address
    type: boolean
    default: null             # not stated by the provider; falls back to the subnet's map_public_ip_on_launch
    constraints: ["overrides the subnet attribute at launch (S2)", "the address is released on stop, hibernate, terminate and when an Elastic IP is associated"]
    src: [S1, S2]
    status: verified
  - key: iam_instance_profile
    type: reference
    ref: iam-role             # via an instance profile; modelled in the IAM group
    constraints: ["profile name, not ARN"]
    src: [S1]
    status: verified          # the relation to roles is in relations/assume-role.md
  - key: key_name
    type: string
    src: [S1]
    status: verified
  - key: user_data
    type: string
    constraints: ["not gzip-compressed; use user_data_base64 for binary", "changing it stops and starts the instance unless user_data_replace_on_change = true"]
    src: [S1]
    status: verified
  - key: user_data_replace_on_change
    type: boolean
    default: false
    src: [S1]
    status: verified
  - key: metadata_options
    type: object
    fields:
      http_endpoint: { default: enabled }
      http_tokens: { values: [optional, required], default: "no default stated by the provider; AWS allows IMDSv1 and IMDSv2 unless set to required" }
      http_put_response_hop_limit: { default: 1, range: [1, 64] }
      instance_metadata_tags: { default: disabled }
    constraints: ["can be modified at any time"]
    src: [S1, S3]
    status: verified
  - key: root_block_device
    type: object
    fields:
      volume_size: {}
      volume_type: { default: "AMI default" }
      encrypted: { default: false }
      delete_on_termination: { default: true }
    constraints: ["changing encrypted or kms_key_id forces replacement", "throughput only with gp3", "iops only with io1, io2, gp3"]
    src: [S1]
    status: verified
  - key: monitoring
    type: boolean
    constraints: ["enables detailed monitoring"]
    src: [S1]
    status: verified
  - key: disable_api_termination
    type: boolean
    src: [S1]
    status: verified
  - key: source_dest_check
    type: boolean
    default: true
    constraints: ["set false only for NAT or VPN instances"]
    src: [S1]
    status: verified
  - key: tags
    type: map
    src: [S1]
    status: verified
limits:
  - { id: on_demand_vcpus, value: "per instance family group, in vCPUs; default depends on account", adjustable: true, src: [S4], status: verified, note: "numeric defaults not read; check Service Quotas" }
  - { id: security_groups_per_network_interface, value: 5, adjustable: true, max: 16, src: [S5], status: verified }
  - { id: outbound_port_25, value: "blocked to public addresses by default", adjustable: true, src: [S4], status: verified, note: "removal must be requested" }
relations: [containment, sg-attach, egress-path, network-access, listener-target, assume-role, eip-attach]
cost: { model: hourly, notes: "instance hours, EBS volumes, and every public IPv4 address (S2). Exact prices unverified" }
status: verified
---

# EC2 instance

## Purpose

A virtual server. Use it when the workload needs full control of the operating system, long-running processes or
software that does not fit containers or functions. For stateless services prefer [ecs](ecs.md) or
[lambda](lambda.md). Do not store data that must survive on an instance's root volume.

## Behaviour

- **Placement.** An instance lives in one subnet, so in one AZ. Its primary network interface gets a private
  IPv4 address from the subnet. That address stays with the interface across stop and start and is released
  only on termination (S2).
- **Public address.** An instance gets a public IPv4 address only if the subnet attribute
  `map_public_ip_on_launch` is on or `associate_public_ip_address` is true at launch; the instance setting
  wins (S2). The address is released on stop, hibernate and terminate, and a new one is assigned on start. It
  is also released when an Elastic IP is associated. For a stable address use an Elastic IP (S2). A public
  address is useless without a route to an internet gateway (S6).
- **Charges.** AWS charges for every public IPv4 address, including those on running instances (S2).
- **Security groups.** Attached to the network interface. In a VPC use `vpc_security_group_ids`;
  `security_groups` is only for EC2-Classic and the default VPC (S1).
- **Updates.** Changing `instance_type` or `user_data` stops and starts the instance. `user_data_replace_on_change`
  makes a user-data change replace the instance instead (S1). Changing the root volume's `encrypted` or
  `kms_key_id` replaces the instance (S1).
- **Metadata service.** Both IMDSv1 and IMDSv2 are accepted by default. Setting `http_tokens = required` makes
  IMDSv1 calls fail (S3). The response hop limit defaults to 1, which can block containers running on the
  instance from reaching the service (S3).
- **Mail.** Outbound port 25 to public addresses is blocked by default and must be unblocked on request (S4).
- **Source/destination check** is on by default and must be off for NAT or VPN instances (S1).
- **Alternative to NAT for maintenance.** An EC2 Instance Connect Endpoint lets you reach an instance in a
  private subnet without a public address (S2). Out of scope for Tier 1.

## Placement

Subnet of a VPC. Public subnet only when the instance must accept connections from the internet directly; the
usual design puts instances in private subnets behind a load balancer.

## Relations

- [containment](../relations/containment.md): the subnet and VPC.
- [sg-attach](../relations/sg-attach.md): `vpc_security_group_ids`; at least one explicit group (D-005).
- [egress-path](../relations/egress-path.md): how a private instance reaches the internet.
- [network-access](../relations/network-access.md): which other workloads it may call or be called by.
- [eip-attach](../relations/eip-attach.md): an optional [elastic-ip](elastic-ip.md) gives the instance a stable public address and replaces its auto-assigned one.
- listener-target: an ALB forwards to the instance as an `instance` target; written with the ALB ([listener-target](../relations/listener-target.md)).
- [assume-role](../relations/assume-role.md): the instance-profile role. The role is wrapped in an instance profile and
  referenced by profile **name**; one role per profile; optional.
- [grant](../relations/grant.md): what the role may do (S3, ECR, RDS IAM authentication).

## Failure modes

| Situation | Result |
|---|---|
| Instance type and AMI architecture differ | Launch fails (unverified) |
| Public address wanted but subnet has no internet-gateway route | Instance has an address and no internet access (S6). Rule [VAL-031](../rules/validation.md) |
| Private instance with no NAT gateway or endpoint | Cannot reach the internet or AWS public endpoints. Rule [VAL-032](../rules/validation.md) |
| `security_groups` used in a non-default VPC | Not applicable; use `vpc_security_group_ids` (S1) |
| `ebs_block_device` mixed with `aws_ebs_volume` / `aws_volume_attachment` on the same instance | Conflict; Terraform treats other devices as drift (S1) |
| `volume_tags` with block-device tags | Resource cycling (S1) |
| Quota of vCPUs for the instance family reached | Launch fails; request an increase (S4) |

## Limits, cost, security

See front matter. Security: require IMDSv2 ([SEC-006](../rules/security.md)), encrypt the root volume
([SEC-007](../rules/security.md)), keep SSH closed to the internet ([SEC-002](../rules/security.md)).

## Terraform mapping

`aws_instance` with `ami`, `instance_type`, `subnet_id`, `vpc_security_group_ids`,
`associate_public_ip_address`, `iam_instance_profile`, `key_name`, `user_data`, `metadata_options`,
`root_block_device`, `tags`. If an [elastic-ip](elastic-ip.md) is attached (an `aws_eip_association`), reference the Elastic IP's address, not the
instance's `public_ip`, which changes after attachment (S1). Add `depends_on = [aws_internet_gateway.<x>]` when
the instance needs a public address. The `network_interface` argument is deprecated; use
`primary_network_interface` and `aws_network_interface_attachment` (S1).

## Sources

S1 to S6 in the front matter.

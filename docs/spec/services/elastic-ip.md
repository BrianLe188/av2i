---
id: elastic-ip
title: { vi: "Elastic IP (địa chỉ IPv4 công khai cố định)", en: "Elastic IP address (EIP)" }
terraform:
  resources: [aws_eip, aws_eip_association]
scope: regional                # allocated to the account in one Region; used in a VPC (domain = vpc)
placement: { requires: [], subnet_type: null, min_azs: null }
sources:
  S1: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/eip.html.markdown
  S3: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/eip_association.html.markdown
  S4: https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html
  S5: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html
scope_note: "Addresses from Amazon's pool only. Bring-your-own pools, IPAM pools, customer-owned pools, network border groups, secondary private IP association and transfer between accounts are out of scope. Provider documentation read at tag v6.66.0 (decision D-001)"
properties:
  - key: domain
    type: enum
    value: vpc
    constraints: ["always vpc; EC2-Classic has retired (S3)"]
    src: [S2, S3]
    status: verified
  - key: tags
    type: map
    constraints: ["applies to VPC addresses only; matching keys override provider default_tags (S2)"]
    src: [S2]
    status: verified
  - key: association
    type: oneOf
    options:
      nat_gateway: { how: "aws_nat_gateway.allocation_id = this address's allocation_id", when: "public zonal NAT gateway" }
      ec2_instance: { how: "one aws_eip_association with allocation_id and instance_id", when: "an EC2 instance with exactly one network interface" }
    constraints:
      - "one resource at a time: an address is associated with at most one instance, network interface or NAT gateway (S1)"
      - "a NAT gateway takes the address through allocation_id; associating it through network_interface fails with AuthFailure (S2, S3)"
      - "the association resource takes instance_id or network_interface_id, never both; an instance with several interfaces needs the interface ID (S3)"
    src: [S1, S2, S3]
    status: verified
  - key: allow_reassociation
    type: boolean
    default: true
    constraints: ["on aws_eip_association; changing it replaces the association (S3)"]
    src: [S3]
    status: verified
exported:
  - { key: allocation_id, note: "also the resource id; what a NAT gateway and an association take", src: [S2] }
  - { key: public_ip, src: [S2] }
  - { key: association_id, src: [S2] }
  - { key: private_ip, src: [S2] }
  - { key: public_dns, note: "computed by the provider from the VPC DNS naming", src: [S2] }
limits:
  - { id: eips_per_region, value: 5, adjustable: true, src: [S1, S4], status: verified, note: "applies to individual accounts and shared VPCs; addresses from a bring-your-own pool do not count (S1)" }
  - { id: eips_per_public_nat_gateway, value: 2, adjustable: true, max: 8, src: [S4], status: verified }
relations: [eip-attach]
cost: { model: hourly, notes: "AWS charges for every public IPv4 address, in use or idle (S1); see the Public IPv4 Address tab of the VPC pricing page. Amounts not recorded here" }
status: verified
---

# Elastic IP address

## Purpose

A static public IPv4 address that belongs to the account until it is released. It is used for two things in this
specification: the address a public zonal [nat-gateway](nat-gateway.md) sends traffic from, and a stable public address
for an [ec2](ec2.md) instance. It is a separate service so it can be drawn, counted and warned about on its own (decision
D-007).

## Behaviour

- **Static and Regional.** The address does not change and can be used only in the Region where it was allocated (S1).
- **Allocate, then associate.** The address is first allocated to the account, then associated with a resource (S1).
- **One target at a time.** It can be moved by disassociating and associating it elsewhere, which breaks active
  connections to the old target (S1).
- **Associating with an instance** also associates it with the instance's primary network interface. If the instance
  already had an auto-assigned public IPv4 address, that address is released and cannot be reused or converted, and the
  instance's public DNS name changes to match the Elastic IP (S1).
- **A NAT gateway takes the address at creation** through `allocation_id`; for a public gateway it cannot be added later
  (S5, nat-gateway S1). Do not associate it through a network interface (S2, S3).
- **It stays after disassociation.** A disassociated address stays allocated until it is released, and is charged all the
  same (S1).
- **Quota.** Five per Region by default, adjustable; AWS recommends using Elastic IP addresses mainly to remap after an
  instance failure and DNS names for traffic between nodes (S1).
- **IPv6.** Elastic IP addresses are IPv4 only (S1).
- **Ordering.** An address may need the internet gateway to exist before the association; the provider says to use
  `depends_on` (S2).

## Placement

Not placed in a VPC or subnet. It reaches a VPC through its association. Outside an association it does nothing and is
only a cost.

## Relations

- [eip-attach](../relations/eip-attach.md): the association with a NAT gateway or an EC2 instance.

## Failure modes

| Situation | Result |
|---|---|
| Public zonal NAT gateway with no address | Creation fails. Rule [VAL-011](../rules/validation.md) |
| Address allocated and not associated | Charged while idle (S1). Rule [VAL-128](../rules/validation.md) |
| Address associated with two resources | Not possible (S1). Rule [VAL-129](../rules/validation.md) |
| More addresses than the Regional quota | Allocation fails (S1, S4). Rule [VAL-130](../rules/validation.md) |
| NAT gateway given more addresses than the per-gateway quota | Rejected (S4). Rule [VAL-130](../rules/validation.md) |
| Address on an instance in a subnet with no route to an internet gateway | The address is useless. Rule [VAL-031](../rules/validation.md) |
| Address attached to a NAT gateway through `network_interface` or `aws_eip_association` | `AuthFailure` (S2, S3). Pitfall P-008 |
| Address and instance in different Regions | Not possible (S1). Rule [VAL-129](../rules/validation.md) |
| Instance replaced or its address released while connections are open | Connections drop (S1) |
| Both `aws_eip.instance` and `aws_eip_association` for one pair | Overwrite; one style per address (S2, S3). Pitfall P-075 |

## Limits, cost, security

See front matter. An address on an instance makes it reachable from the internet if its subnet routes to an internet
gateway and its security groups allow it; the exposure rules are [SEC-001](../rules/security.md) and
[SEC-002](../rules/security.md). A NAT gateway's address is the source address of everything behind it, which matters
when a partner allow-lists it; the address is kept across NAT gateway replacement only if the allocation is reused.

## Terraform mapping

`aws_eip` with `domain = "vpc"` and `tags`. For a NAT gateway, pass `aws_eip.<x>.id` (the allocation ID) as
`aws_nat_gateway.allocation_id`. For an instance, emit one `aws_eip_association` with `allocation_id` and `instance_id`;
leave `instance` and `network_interface` unset on the `aws_eip` (S2, S3). Add `depends_on = [aws_internet_gateway.<x>]`.
Reference the address through `aws_eip.<x>.public_ip`, not the instance's `public_ip` (pitfall P-021).

## Sources

S1 to S5 in the front matter.

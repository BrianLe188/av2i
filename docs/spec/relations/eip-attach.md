---
id: eip-attach
title: { vi: "Gắn Elastic IP vào NAT Gateway hoặc EC2", en: "Elastic IP attachment" }
participants:
  - { role: address, service: elastic-ip }
  - { role: target, service: [nat-gateway, ec2] }
direction: address->target
same_vpc: false
same_region: true                  # an Elastic IP is used only in the Region where it was allocated (verified)
cardinality: { address: one, target: "nat-gateway: 1 to 2 (up to 8 by quota); ec2: one" }   # one target per address
user_drawn: partly                 # NAT gateway: created with the gateway and shown as a derived node (D-030); EC2: drawn by the user
generates:
  - { terraform: "aws_eip (domain = vpc)", on: address }
  - { terraform: "aws_nat_gateway.allocation_id = aws_eip.<x>.id", on: nat-gateway, when: "public zonal" }
  - { terraform: "aws_eip_association (allocation_id, instance_id)", on: ec2 }
  - { terraform: "depends_on = [aws_internet_gateway.<x>]", on: address }
conditions:
  - { text: { vi: "Chỉ NAT Gateway công khai kiểu zonal mới nhận Elastic IP; NAT Gateway private và regional thì không", en: "Only a public zonal NAT gateway takes an Elastic IP; a private or regional one does not" }, when: "target is nat-gateway" }
  - { text: { vi: "EC2 chỉ có một network interface thì mới gắn qua instance_id", en: "An EC2 instance is attached through instance_id only when it has one network interface" }, when: "target is ec2" }
  - { text: { vi: "Mỗi Elastic IP chỉ gắn một tài nguyên", en: "An Elastic IP is attached to one resource at a time" }, when: always }
effects:
  - "nat-gateway: the address is the source address of all traffic that leaves through the gateway"
  - "ec2: the instance's auto-assigned public IPv4 address is released and the address becomes its public address; the public DNS name changes"
invalid_when: [VAL-011, VAL-031, VAL-128, VAL-129, VAL-130]
sources:
  S1: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/eip.html.markdown
  S3: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/eip_association.html.markdown
  S4: https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html
  S5: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html
status: verified          # the NAT gateway side relies on the nat-gateway file; one address per target for EC2 is stated for the primary interface only
---

# Elastic IP attachment

## Meaning

Connects an [elastic-ip](../services/elastic-ip.md) to the resource that uses it as its public IPv4 address. Two kinds of
target exist, with different Terraform shapes.

## Cases

| # | Address | Target | Result |
|---|---|---|---|
| 1 | one | public zonal NAT gateway | The gateway sends traffic from this address; given at creation (S5, S2) |
| 2 | two or more | one public zonal NAT gateway | Allowed up to the per-gateway quota (2 by default, 8 at most); extra addresses are `secondary_allocation_ids` (S4) |
| 3 | none | public zonal NAT gateway | Invalid. [VAL-011](../rules/validation.md) |
| 4 | any | regional or private NAT gateway | Not allowed: a regional gateway takes no `allocation_id` and a private one has no Elastic IP (nat-gateway S1, S4) |
| 5 | one | EC2 instance with one network interface | Instance gets a stable public address; its auto-assigned address is released (S1) |
| 6 | one | EC2 instance in a subnet with no route to an internet gateway | Address is useless. [VAL-031](../rules/validation.md) |
| 7 | one | EC2 instance with several network interfaces | Needs the interface ID; not modelled in the first version |
| 8 | one | two targets | Not possible. [VAL-129](../rules/validation.md) |
| 9 | one | nothing | Allocated and idle; still charged. [VAL-128](../rules/validation.md) |
| 10 | more than the Regional quota | any | Allocation fails. [VAL-130](../rules/validation.md) |

## Failure modes

| Situation | Result |
|---|---|
| EIP attached to a NAT gateway through `aws_eip_association` or `network_interface` | `AuthFailure` (S2, S3). Pitfall P-008 |
| `aws_eip.instance` and `aws_eip_association` both used | Overwrites; use the association resource only. Pitfall P-075 |
| Replacing an instance that holds the address | The association is replaced; the address is kept only while the `aws_eip` stays |
| Changing `allocation_id`, `instance_id`, `network_interface_id`, `allow_reassociation` or `private_ip_address` on the association | Forces a new association (S3). Pitfall P-076 |

## Terraform mapping

NAT gateway: `aws_nat_gateway.allocation_id = aws_eip.<x>.id`. EC2: `aws_eip_association` with `allocation_id` and
`instance_id`. See [elastic-ip](../services/elastic-ip.md) and [nat-placement](nat-placement.md).

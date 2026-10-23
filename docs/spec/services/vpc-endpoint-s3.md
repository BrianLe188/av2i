---
id: vpc-endpoint-s3
title: { vi: "VPC Gateway Endpoint cho S3", en: "VPC gateway endpoint for Amazon S3" }
terraform:
  resources: [aws_vpc_endpoint, aws_vpc_endpoint_route_table_association]
scope: vpc                     # created in one VPC and usable only for S3 in the same Region
placement: { requires: [vpc, route-table], subnet_type: null, min_azs: null }
sources:
  S1: https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html
  S2: https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html
  S3: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/vpc_endpoint.html.markdown
  S4: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/vpc_endpoint_route_table_association.html.markdown
  S5: https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html
scope_note: "Gateway type for general purpose S3 buckets only (decision D-029). Interface endpoints, the DynamoDB gateway endpoint, S3 directory buckets (s3express), IPv6 and DNS record IP type are out of scope"
properties:
  - key: vpc_id
    type: reference
    ref: vpc
    required: true
    src: [S3]
    status: verified
  - key: service_name
    type: string
    required: true
    value: "com.amazonaws.<region>.s3"
    constraints: ["derived from the Region of the design, never typed", "the endpoint serves S3 in this Region only (S1)"]
    src: [S1, S3]
    status: verified
  - key: vpc_endpoint_type
    type: enum
    value: Gateway
    default: Gateway
    constraints: ["fixed; the provider default is Gateway (S3)"]
    src: [S3]
    status: verified
  - key: route_table_ids
    type: list
    ref: route-table
    constraints:
      - "emitted as one aws_vpc_endpoint_route_table_association per table, never as route_table_ids on the endpoint, because the provider says the two styles conflict (S3)"
      - "a route table has at most one endpoint route to S3; one endpoint may serve many tables (S2)"
    src: [S2, S3, S4]
    status: verified
  - key: policy
    type: json
    default: "full access (Effect Allow, Principal *, Action *, Resource *)"
    constraints:
      - "one policy per endpoint; must contain a Principal element; at most 20,480 characters including white space (S5)"
      - "for a gateway endpoint Principal must be \"*\"; restrict principals with the aws:PrincipalArn condition key (S5)"
      - "\"AWS\": \"<account id>\" grants the account root user only, not every user and role (S5)"
      - "it never replaces identity or bucket policies; it is one more layer that must allow (S5)"
      - "changes can take a few minutes to apply (S1, S5)"
    src: [S1, S3, S5]
    status: verified
  - key: ip_address_type
    type: enum
    values: [ipv4]
    constraints: ["only ipv4 is in scope (decision D-003); the provider also accepts dualstack and ipv6 (S3)"]
    src: [S2, S3]
    status: verified
  - key: tags
    type: map
    src: [S3]
    status: verified
exported:
  - { key: id, src: [S3] }
  - { key: arn, src: [S3] }
  - { key: prefix_list_id, note: "Gateway only; used in security group rules and in the route destination", src: [S3] }
  - { key: cidr_blocks, note: "Gateway only", src: [S3] }
limits:
  - { id: gateway_endpoints_per_region, value: 20, adjustable: true, src: [S1], status: verified }
  - { id: gateway_endpoints_per_vpc, value: 255, adjustable: false, src: [S1], status: unverified, note: "the page gives the number without saying whether it can be raised" }
  - { id: endpoint_routes_to_one_service_per_route_table, value: 1, adjustable: false, src: [S2], status: verified }
  - { id: endpoint_policy_size_characters, value: 20480, adjustable: false, src: [S5], status: verified }
relations: [containment, route]
cost: { model: free, notes: "no additional charge for gateway endpoints (S1, S2); S3 data transfer follows normal S3 pricing" }
status: verified
---

# VPC gateway endpoint for S3

## Purpose

Lets workloads in private subnets reach S3 without an internet gateway or a NAT gateway, at no extra cost (S1, S2).
Without it, a private subnet reaches S3 only through a NAT gateway, because S3 is a public service endpoint and
private subnets by definition have no route to an internet gateway (S2). The endpoint is therefore the usual answer to
the NAT data charge for S3 traffic.

## Behaviour

- **It is a route target, not a network interface.** Associating a route table with the endpoint makes AWS add a route
  whose destination is the S3 prefix list and whose target is the endpoint. The route can be viewed but not changed or
  deleted by hand; it disappears when the table is disassociated or the endpoint is deleted (S2, S1).
- **It applies per route table.** Every subnet that uses an associated route table uses the endpoint automatically.
  Subnets on other route tables keep using S3's public endpoint (S2).
- **It wins over the internet route.** AWS picks the most specific route. A `0.0.0.0/0` route to an internet gateway
  loses to the endpoint route for S3 in the same Region. An exact route for the S3 address range, if present, would beat
  the endpoint (S2).
- **Same Region only.** The endpoint exists only in the Region where it was created, and prefix lists are per Region, so
  traffic to a bucket in another Region still goes to the internet gateway or the NAT gateway (S1, S2).
- **Reach is limited to the VPC.** Peered VPCs in other Regions, VPN, Direct Connect and transit gateway traffic cannot
  use it; those need an interface endpoint (S1).
- **Addresses seen by S3 change.** Requests arrive from the instance's private address instead of a public one. Creating
  or changing the endpoint switches routes and breaks open TCP connections; they are not resumed (S1). The condition
  key `aws:SourceIp` does not work for requests through an endpoint; use `aws:VpcSourceIp`, `aws:SourceVpc` or
  `aws:SourceVpce` (S1).
- **Security groups and network ACLs still apply.** Workloads reach S3 on its public address, so their security group
  egress must allow it, and a rule can name the S3 prefix list. A network ACL cannot name a prefix list; it needs the
  CIDR ranges from the list (S1, S2).
- **Policy layers.** The endpoint policy is a resource policy on the endpoint. A request must be allowed by the
  identity policy, any bucket policy and the endpoint policy (S5). The default policy allows everything (S5).
- **DNS.** With Amazon DNS, both DNS resolution and DNS hostnames must be enabled on the VPC (S1).
- **Directory buckets** use a different service name (`s3express`) and are not covered (S1).

## Placement

VPC level. It has no subnet and no security group. It is useful only when at least one associated route table serves
a subnet with workloads that call S3.

## Relations

- [containment](../relations/containment.md): belongs to exactly one VPC.
- [route](../relations/route.md): a route table is associated with the endpoint; this is the only way the endpoint is
  used. The route is generated by AWS, not written as an `aws_route`.
- [egress-path](../relations/egress-path.md): the platform derives whether each workload has a path to S3 from this
  association; see VAL-070.

## Failure modes

| Situation | Result |
|---|---|
| Endpoint in another Region than the bucket | Traffic to the bucket does not use the endpoint (S1, S2). Rule [VAL-126](../rules/validation.md) |
| Two endpoint routes to S3 in one route table | Not possible (S2). Rule [VAL-122](../rules/validation.md) |
| Route table and endpoint in different VPCs | Rejected; the endpoint belongs to one VPC. Rule [VAL-122](../rules/validation.md) |
| Associating a table with both `route_table_ids` and an association resource | Conflict; the second overwrites the first (S3). Pitfall P-070 |
| Endpoint policy without `Principal`, or with a principal other than `*` and no condition | Rejected or unintended access (S5). Rule [VAL-125](../rules/validation.md) |
| Security group egress restricted and S3 not allowed | Requests time out. Rule [VAL-127](../rules/validation.md) |
| Network ACL does not allow the S3 ranges | Requests time out (S2); network ACLs are out of scope (D-008) |
| Bucket policy uses `aws:SourceIp` for requests through the endpoint | The condition does not match (S1). Rule [SEC-044](../rules/security.md) |
| VPC without DNS support or DNS hostnames | Name resolution of S3 may fail (S1). Rule [VAL-124](../rules/validation.md) |
| Endpoint created or changed while a job is running | Open connections drop (S1). Behaviour only; no rule |
| Deleting the endpoint | The endpoint route is removed from the associated tables; workloads then need another path (S1) |
| Policy that allows only some buckets, and a service needs another bucket | That service fails; AWS services that fetch software from S3 need `s3:GetObject` on their buckets (S1) |

## Limits, cost, security

See front matter. The endpoint costs nothing, but its default policy is full access ([SEC-043](../rules/security.md)).
A policy that names buckets or `aws:PrincipalArn` narrows what the VPC can do with S3 and helps against data
exfiltration to other accounts' buckets (S5; the `s3:ResourceAccount` pattern is in S1).

## Terraform mapping

`aws_vpc_endpoint` with `vpc_id`, `service_name = "com.amazonaws.<region>.s3"`, `vpc_endpoint_type = "Gateway"` (the
default), optional `policy`, and `tags`. One `aws_vpc_endpoint_route_table_association` per route table, with
`route_table_id` and `vpc_endpoint_id`. Do not set `route_table_ids` on the endpoint when using the association
resource (S3, S4). The S3 prefix list is available as `aws_vpc_endpoint.<x>.prefix_list_id` for security group rules.

## Sources

S1 to S5 in the front matter.

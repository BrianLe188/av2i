# Decisions and open questions

Entries with `status: open` need an answer from the owner before implementation. Decided entries stay here as
the record.

| ID | Status | Topic |
|---|---|---|
| D-001 | decided | Exact provider and OpenTofu versions |
| D-002 | decided | Regional NAT gateway: specified alongside zonal; first implementation zonal only |
| D-003 | decided | Secondary VPC CIDR blocks and IPv6 |
| D-004 | decided | Route targets beyond internet gateway and NAT gateway |
| D-005 | decided | Resources with no explicit security group: an error (explicit group required) |
| D-006 | decided | Manage the VPC's default route table, security group and network ACL? |
| D-007 | decided | Elastic IP is its own Tier 1 service (owner's choice, against the earlier recommendation to hide it) |
| D-008 | decided | Network ACLs |
| D-009 | decided | Rules are emitted as separate resources, routes as `aws_route` |
| D-010 | decided | Lambda scope: classic event functions only |
| D-011 | decided | ECS scope: Fargate only |
| D-012 | decided | Which security group carries a network-access rule: the only group, else the connection names one |
| D-013 | decided | Task container definitions: structured subset first, raw JSON override later |
| D-014 | decided | EC2 launch details: AMI by data-source lookup, existing key name, no launch templates |
| D-015 | decided | RDS scope: single instance, PostgreSQL and MySQL |
| D-016 | decided | Safe defaults for S3 buckets |
| D-017 | decided | Safe defaults for RDS instances, including the RDS-managed master password |
| D-018 | decided | How S3 bucket names are chosen: account regional namespace where known, else typed name |
| D-019 | decided | ALB scope: Application only, default-action listeners, no listener rules (rules are the first follow-up) |
| D-020 | decided | Route 53 scope: public zones, alias and validation records only |
| D-021 | decided | CloudFront scope: standard distribution, S3 through OAC and ALB origins, cache policies by data source |
| D-022 | decided | ACM scope; generate a us-east-1 provider alias when CloudFront is present |
| D-023 | decided | HTTPS by default for ALB and CloudFront |
| D-024 | decided | IAM scope: roles for AWS services, instance profiles, policies |
| D-025 | decided | Which roles the platform creates itself and which the user draws |
| D-026 | decided | How permissions are expressed: generated grants, with a checked raw-JSON escape hatch |
| D-027 | decided | Sharing one role between several workloads |
| D-028 | decided | The deploying identity and the IAM permissions it needs |
| D-029 | decided | VPC endpoints: rules mention them, no Tier 1 service can express them |
| D-030 | decided | How the Elastic IP of a NAT gateway appears: drawn by the user or created for them |

## D-001 Exact versions

Status: decided (owner accepted the proposal, 23 October 2026). Provider `~> 6.66.0` (released 21 September 2026, about a month old; the latest was 6.70.0 on 22 October and the provider releases weekly), OpenTofu `>= 1.12.0, < 1.13.0` (1.12.9 is the latest patch of that line; 1.13.0 is three weeks old). Commit the lock file. The choice rests on release age, not on a changelog review, so a regression in 6.66 is not excluded. Follow-up done on 23 October 2026: every provider page was compared at `main` and at `v6.66.0` and all URLs point at the tag; see [sources.md](sources.md). Original analysis follows. The README pins the AWS provider to `~> 6.0` and OpenTofu to `>= 1.10`. Official release pages
were not read; unofficial listings suggest provider 6.5x and OpenTofu 1.12, one listing noting a withdrawn
patch release. Choose an exact minor release, commit the lock file, and re-check the provider docs of that
release. The docs read for this group are from the `main` branch.

## D-002 Regional NAT gateway

Status: **decided** (option 1). The specification covers zonal and regional gateways; the first implementation
builds zonal only. Regional availability by Region is still unchecked and must be verified before regional
becomes a default. Original analysis follows.

The provider and AWS now offer a **regional** NAT gateway (`availability_mode = "regional"`) that
needs no public subnet, no per-AZ gateways and no manual route edits, and that expands to AZs by itself.
Existing designs, and the platform's previous version, assume one zonal gateway per public subnet.

Options:
1. Support both. Zonal stays the default; regional is a mode on the same service. The model gains a branch:
   no `subnet_id`, no Elastic IP, a different route-table story.
2. Zonal only for the first version, regional later.
3. Regional by default.

Recommendation: option 1 in the specification, with the first implementation covering zonal only. The facts
needed for both are already in [services/nat-gateway.md](services/nat-gateway.md). Regional NAT does not
support private NAT and is not available in constrained Availability Zones, and I have not checked which
Regions offer it. Verify availability before making it a default.

## D-003 Secondary CIDR and IPv6

Status: decided (recommendation accepted). Secondary IPv4 CIDRs and IPv6 are real but add many branches (more local routes, IPv6 routes,
egress-only gateways, dual-stack security group rules). Recommendation: out of the first version. The model
keeps the property names so they can be added without renaming.

## D-004 Route targets

Status: decided (recommendation accepted): internet gateway, NAT gateway and the S3 gateway endpoint (D-029) are the route targets; peering, transit gateway and the rest wait for Tier 2. Routes may also target peering, transit gateway, virtual private gateway, VPC endpoint, network
interface and others. Only internet gateway and NAT gateway are Tier 1 services. A VPC endpoint (a Tier 2
service) matters in practice: it is how private subnets reach S3 without a NAT gateway. Recommendation: keep
the route mechanism open to new target services and add VPC endpoint first when Tier 2 starts.

## D-005 No explicit security group

Status: **decided** (option 3). A resource that takes security groups must have at least one explicit group
attached. Having none is an error (rule [VAL-029](rules/validation.md)); the VPC default group is never used
implicitly. The UI should be able to create and attach a group in one step. Resources covered: EC2, ECS
service, Lambda in a VPC, RDS, ALB. Original analysis follows.

AWS gives such a resource the VPC's default group, which allows all traffic among its members
and all outbound traffic. The previous version created a dedicated managed group per resource. Options:
1. Create a managed group per resource (safe, many groups).
2. Use the VPC default group (AWS behaviour, open by default, rule [SEC-004](rules/security.md)).
3. Require an explicit group and make it an error.

Recommendation: option 3 for resources that accept traffic from other tiers (databases, application servers),
with the UI able to create a group in one click. It keeps the diagram honest: the security boundary is always
visible. Needs your decision because it changes how much the user must draw.

## D-006 Default route table, security group, network ACL

Status: decided (recommendation accepted): manage the VPC's default security group with `aws_default_security_group` and no rules, so SEC-005 stops being permanent noise; leave the default route table and the default network ACL untouched. The provider page was read at v6.66.0 and the facts are recorded in [services/vpc.md](services/vpc.md) and pitfalls P-078 to P-080: the resource adopts the existing group and removes all its rules at once, declares rules inline as absolute, and conflicts with separate rule resources, so nothing else may attach rules to the default group. AWS creates them with every VPC. The default group is open ([SEC-005](rules/security.md)).
Options: leave them untouched, or manage them (`aws_default_security_group`, and similar for the others) so the
default group has no rules. The `aws_default_*` resources were not read (unverified).

## D-007 Elastic IP

Status: decided by the owner: the Elastic IP is its own Tier 1 service ([elastic-ip](services/elastic-ip.md), mechanism [eip-attach](relations/eip-attach.md)), not a hidden part of the NAT gateway. This replaces the recommendation below, which was to hide it for now. Reason given: it can be drawn, counted against the Regional quota and attached to EC2 from the start. How the address of a NAT gateway shows on the canvas is D-030. The Elastic IP is not in the Tier 1 list but a public zonal NAT gateway requires one. Options:
treat it as an implementation detail of the NAT gateway (created automatically), or make it its own service so
it can also be attached to an EC2 instance. Recommendation: hidden for now. Quota is 5 per Region by default
and the platform should warn when the design needs more.

## D-008 Network ACLs

Status: decided (recommendation accepted): not modelled; the default network ACL allows all traffic. A custom ACL added outside the platform can block traffic that no rule here detects. A stateless subnet-level filter with its own rules and quotas (20 rules per ACL by default). Not
in Tier 1. Every VPC has a default ACL that allows all traffic. Recommendation: not modelled in the first
version; document that the default is open.

## D-010 Lambda scope

Status: **decided** (recommendation accepted). Lambda now has several product types: classic event functions (zip or container image),
Managed Instances, MicroVMs, Web Functions and durable functions. They differ in limits (the provider page lists
32,768 MB of memory for Managed Instances against 10,240 MB for classic functions), networking (Web Functions use
egress network connectors) and Region availability. Recommendation: the first version covers classic event
functions only, which is what [services/lambda.md](services/lambda.md) specifies. The others become separate
services if wanted.

## D-011 ECS scope

Status: **decided** (recommendation accepted). Fargate only: no EC2 launch type, Managed Instances, `EXTERNAL`, `DAEMON`, Service Connect, EFS or
EBS volumes, or blue/green deployments. Rationale: removes the container-instance fleet, capacity providers and
placement strategy, which are a second service worth of rules. Recommendation: accept. The ECS service file
records which parts are out of scope so they are not added by accident.

## D-012 Which security group carries a network-access rule

Status: **decided** (recommendation accepted). A resource can have up to five explicit groups. Recommendation: exactly one group on a side means
that group; several means the connection names one on each side; never the VPC default group. See
[relations/network-access.md](relations/network-access.md).

## D-013 Container definitions

Status: **decided** (recommendation accepted). The provider takes `container_definitions` as one JSON document, and formatting differences show up
as diffs. Options: (1) expose the JSON as text, (2) model a structured subset (name, image, port mappings,
environment, secrets, log configuration, health check, command) and generate the JSON with `jsonencode`,
(3) both, structured by default with a raw override. Recommendation: option 3 later, option 2 first, because the
structured form lets the platform validate ports, link images to ECR and wire secrets and logs.

## D-014 EC2 launch details

Status: **decided** (recommendation accepted). The provider lets an instance take `ami` and `instance_type` from a launch template. The platform
requires them directly. Open: how the user picks an AMI (a fixed ID, an AMI lookup through a data source such as
the latest Amazon Linux, or a free text), and how key pairs are handled (existing key name only, or generated).
Recommendation: AMI by data-source lookup with a pinned family, key name as an existing-key reference, no
launch templates in the first version.

Consequence (done): `ami_family` (Amazon Linux 2023 or Ubuntu 24.04, default Amazon Linux 2023) is looked up through `data "aws_ami"` when `ami` is empty, with the architecture taken from the instance type (Arm for Graviton families), and the instance ignores later changes of the looked-up image; `key_name` is emitted when set; VAL-030 accepts either an `ami` or a known family.

## D-015 RDS scope

Status: **decided** (recommendation accepted). One `aws_db_instance` running PostgreSQL or MySQL, with optional Multi-AZ instance deployment. Out of
scope: Aurora, Multi-AZ DB clusters, read replicas, RDS Proxy, Custom, Oracle, SQL Server, Db2, MariaDB, blue/green,
parameter and option groups, Active Directory, S3 import, snapshots and restores, IPv6 and dual-stack. Rationale:
these two engines cover most application databases, and each excluded item brings its own rule set (for example
credentials managed by Secrets Manager are not supported with replicas of that source or with blue/green, which
removes a whole interaction). Recommendation: accept; the service file records the exclusions. Parameter groups are
the first thing users will ask for next (connection limits), so plan them as a follow-up service.

## D-016 Safe defaults for S3

Status: **decided** (recommendation accepted). The provider's defaults are weak for a hosted design: all four Block Public Access flags default to
false, versioning to disabled, the access block resource is separate and optional. Recommendation: the platform
emits all four Block Public Access flags `true`, Object Ownership `BucketOwnerEnforced`, versioning `Enabled`,
default encryption SSE-S3, `force_destroy` false, and one merged bucket policy. A bucket that must be public (static
website, public assets) is a deliberate per-bucket choice that turns off the relevant flags and is flagged
[SEC-012](rules/security.md). CloudFront-fronted buckets stay private (the policy lets only the distribution read).

## D-017 Safe defaults for RDS

Status: **decided** (recommendation accepted). Provider defaults that are unsafe or surprising: `backup_retention_period` 0 (no automated backups),
`storage_encrypted` false and not changeable later, `deletion_protection` false, `skip_final_snapshot` false but
without an identifier, `password` stored in state. Recommendation: emit `storage_encrypted = true`,
`manage_master_user_password = true` (the secret is then read by the application through Secrets Manager, a Tier 2
service, and the task or function role needs permission to read it), `backup_retention_period` of 7 (the common
console default, unverified), `deletion_protection` true for production-marked designs, `publicly_accessible`
false, and an explicit final snapshot identifier. Trade-off to confirm: managed credentials make Secrets Manager a
dependency of every database, and the secret ARN has to reach the workloads, which needs the `secret-reference`
mechanism that Tier 2 would add. If that is too early, use `password` with the warning
[SEC-020](rules/security.md) in the first version.

## D-018 S3 bucket names

Status: **decided** (recommendation accepted). Bucket names are global and cannot change. Options: (1) the user types a name, checked for format only;
(2) the platform appends a random suffix; (3) the account regional namespace
(`<prefix>-<account-id>-<region>-an`), which only your account can own and which the provider supports through
`bucket_namespace`. Recommendation: option 3 when the target account and Region are known, with option 1 as the
fallback. Check Region availability of the account regional namespace before making it the default (not read).

## D-019 ALB scope

Status: **decided** (recommendation accepted). Application Load Balancer with HTTP and HTTPS listeners whose **default action** forwards to one
target group, redirects or returns a fixed response; target groups of type `instance`, `ip` and `lambda`.
Out of scope: Network and Gateway load balancers, **listener rules** (host and path routing), authentication actions
(Cognito, OIDC, JWT), mutual TLS, WAF association, IPAM address pools, Local Zone and Outpost subnets, weighted
forwarding, gRPC and HTTP/2 to targets, target optimizer, dual-stack and stickiness beyond defaults. Trade-off: path
and host routing are how one ALB serves several services, so users will ask for them early. Recommendation: accept the
smaller scope for the first version and make `aws_lb_listener_rule` (conditions, priority, actions) the first
follow-up; the specification keeps the listener-target mechanism open for it. The provider page for the rule resource
was not read.

## D-020 Route 53 scope

Status: **decided** (recommendation accepted). Public hosted zones; A and AAAA alias records to ALB and CloudFront; the CNAME records that validate ACM
certificates. Out of scope: domain registration and the registrar's name server settings, private hosted zones and VPC
association, weighted, latency, failover, geolocation and geoproximity routing, health checks, DNSSEC, query logging,
Resolver, Profiles and traffic flow. Recommendation: accept. The platform must say clearly that the domain has to be
delegated to the zone's name servers by the user; it cannot do it.

## D-021 CloudFront scope

Status: **decided** (recommendation accepted). A standard distribution with S3 origins (regular endpoint through origin access control) and ALB custom
origins, one default and several ordered behaviours, managed cache policies, one viewer certificate. Out of scope:
Lambda@Edge, CloudFront Functions, signed URLs and cookies, field-level encryption, origin groups and failover, VPC
origins (so no internal ALB origin), multi-tenant distributions, mTLS, continuous deployment, real-time and legacy
logging, origin access identity and the deprecated `forwarded_values`. Open sub-question: how managed cache policies
are referenced (a fixed ID, or the `aws_cloudfront_cache_policy` data source by name, not read). Recommendation:
accept the scope; use the data source by name so IDs are not hard-coded.

## D-022 ACM scope and the us-east-1 provider

Status: **decided** (recommendation accepted). Public Amazon-issued certificates, DNS validation in Route 53. Out of scope: email validation, imported
and private-CA certificates, exportable certificates, ACME. A CloudFront certificate must be in `us-east-1`, so a
design with CloudFront needs a second provider configuration (an alias for `us-east-1`) even when everything else is
in another Region. Options: (1) generate the alias provider automatically whenever a CloudFront distribution is on
the canvas; (2) ask the user to choose the Region of the certificate; (3) forbid CloudFront in the first version.
Recommendation: option 1, shown to the user as "this certificate is created in us-east-1 because CloudFront requires
it". It changes the shape of the generated Terraform (a provider block with an `alias`), which the code generator
must support from the start.

## D-023 HTTPS by default

Status: **decided** (recommendation accepted). Recommendation: an internet-facing ALB gets an HTTPS listener with `ELBSecurityPolicy-TLS13-1-2-2021-06`
and an HTTP listener that only redirects; CloudFront uses `redirect-to-https` and `TLSv1.2_2021`; HTTP-only designs are
allowed but raise [SEC-024](rules/security.md) or [SEC-029](rules/security.md). Consequence: a public web design needs a
domain, a Route 53 zone and an ACM certificate, which is a bigger starting point than "a load balancer". The UI should
offer a template that creates all four.

## D-024 IAM scope

Status: decided (accepted recommendation). Roles that an AWS service assumes (EC2 through an instance profile, Lambda execution role, ECS task role
and task execution role, RDS Enhanced Monitoring role), their managed, inline and customer managed policies, and the
policy document language shared with trust and resource policies. Out of scope: IAM users, groups and access keys,
federation (SAML, OIDC, Identity Center), IAM Roles Anywhere, cross-account roles, permissions boundaries, service
control and resource control policies, session policies, service-linked roles and Access Analyzer. Rationale: AWS
advises workloads to use roles with temporary credentials, not users and long-term keys (the platform therefore never
creates an access key), and each excluded item multiplies the rules. A `permissions_boundary` property is kept in the
model so it can be switched on later.

## D-025 Which roles the platform creates

Status: decided (accepted recommendation). Two kinds of role exist. **Required roles** carry a fixed set of permissions the service itself needs:
the Lambda execution role (logs, VPC interfaces), the ECS task execution role (image pull, logs, secrets), the RDS
monitoring role. **Application roles** carry what the user's code is allowed to do: the EC2 instance role, the ECS task
role, extra permissions on a Lambda role. Recommendation: the platform creates required roles automatically with the
managed policies in [assume-role](relations/assume-role.md) and shows them on the canvas as derived (not drawn by the
user, replaceable by choosing a role); application roles are drawn by the user as role nodes and connected to a workload
and to targets (grants). Consequence: a template that needs S3 from EC2 shows two connections (assume-role, grant), not
the old direct line.

## D-026 How permissions are expressed

Status: decided (accepted recommendation). Options: (1) generated statements only, from the grant registry; (2) raw JSON only; (3) generated by
default plus a raw-JSON policy as an escape hatch. Recommendation: option 3. Generated grants give exact ARNs and
stable statement IDs; the raw policy is validated by the same rules (structure, size, wildcards, escalation) and is
flagged when it uses `Resource: "*"` or service-wide actions
([SEC-036](rules/security.md) to [SEC-038](rules/security.md)). The raw policy is attached as a separate inline policy
so it never collides with the generated one.

## D-027 Shared roles

Status: decided (accepted recommendation). AWS allows one role to serve several workloads, and an EC2 profile can be reused. Sharing makes the
role's permissions the union of everyone's needs, against least privilege (ECS advice: a role per task definition or
service). Recommendation: allow sharing but flag it ([SEC-041](rules/security.md)); the trust policy then lists each
distinct service principal once, and an EC2 consumer still gets its own instance profile.

## D-028 The deploying identity

Status: decided (accepted recommendation). Whoever applies the generated Terraform needs IAM permissions: `iam:CreateRole`, `iam:PutRolePolicy`,
`iam:AttachRolePolicy`, `iam:CreateInstanceProfile`, `iam:AddRoleToInstanceProfile`, and `iam:PassRole` on the roles it
hands to services. Those permissions are themselves an escalation path (a person who can create a role and attach any
policy can raise their own permissions), so they should be scoped to the roles of this design and, where possible,
bounded. Recommendation: the platform produces, with every export, the list of IAM permissions (and the role-name
pattern) the deployer needs, as a policy the user can review. It does not create the deployer.

## D-009 Separate resources

Status: decided (from provider guidance). Security group rules are separate resources, one per rule and port
range, and routes are `aws_route` resources, because inline forms conflict with them and own the whole list
(pitfalls P-001, P-002).

## D-029 VPC endpoints

Status: decided (accepted recommendation: option 2). VAL-042 (ECS image pull) and VAL-070 (S3 from a private subnet) accept "an ECR interface endpoint" or "a gateway
VPC endpoint" as a way out, but VPC endpoints are Tier 2, so a design cannot contain one and the rules can only warn. The
scenarios [three-tier-web](scenarios/three-tier-web.md) and [isolated-private-app](scenarios/isolated-private-app.md) hit this.
Options: (1) keep endpoints Tier 2 and leave the warnings as they are, the user acts outside the platform; (2) promote the
gateway endpoint for S3 (free, route-table based) to Tier 1 and leave interface endpoints for Tier 2; (3) promote both.
Recommendation: option 2. It removes the NAT data charge for S3 traffic, which is the common cost surprise, adds one
mechanism (`route` to an endpoint, already anticipated by D-004) and no new security group handling, whereas interface
endpoints need their own security groups, private DNS and per-AZ cost.

Consequence (done): [services/vpc-endpoint-s3.md](services/vpc-endpoint-s3.md) is written, [route](relations/route.md) takes the
endpoint as a target, VAL-070 now accepts the endpoint, and VAL-122 to 127, SEC-043 and SEC-044 and pitfalls P-070 to P-074 are
added. VAL-042 is left as it was: it mentions an ECR interface endpoint, which stays Tier 2, so the ECR image-pull gap in
[isolated-private-app](scenarios/isolated-private-app.md) remains.

## D-030 Elastic IP of a NAT gateway

Status: decided (option 2 of the analysis below, listed first in the owner's answer: the platform creates the address with the NAT gateway and shows it as a derived, replaceable node). A public zonal NAT gateway cannot exist without an Elastic IP (VAL-011), and the owner made the Elastic IP its own
service (D-007). Options: (1) the user draws an Elastic IP and connects it to every NAT gateway, so a design with one gateway
per AZ shows N extra nodes and N extra lines; (2) the platform creates the address when a NAT gateway is added, shows it as a
derived node, and lets the user replace it by choosing another address, as with required roles (D-025); (3) the NAT gateway
carries a hidden address again. Recommendation: option 2. It keeps the address visible, countable and replaceable, as D-007
wants, without making the user draw a mandatory line, and it matches the treatment of required roles. An EC2 Elastic IP is
always drawn by the user because it is optional.

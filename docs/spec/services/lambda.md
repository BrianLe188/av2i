---
id: lambda
title: { vi: "Lambda (hàm serverless)", en: "AWS Lambda function" }
terraform:
  resources: [aws_lambda_function]
scope: regional
placement:
  requires: []                 # outside a VPC by default
  subnet_type: private         # when attached to a VPC
  min_azs: 2                   # recommended, not required
sources:
  S1: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lambda_function.html.markdown
  S2: https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
  S3: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html
  S4: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html
  S5: https://docs.aws.amazon.com/lambda/latest/dg/images-create.html
scope_note: "Covers classic event functions (zip or container image). Managed Instances, MicroVMs, Web Functions and durable functions are out of scope (decision D-010)"
properties:
  - key: function_name
    type: string
    required: true
    src: [S1]
    status: verified
  - key: package_type
    type: enum
    values: [Zip, Image]
    default: Zip
    constraints: ["cannot be changed on an existing function; create a new one (S5)"]
    src: [S1, S5]
    status: verified
  - key: code_source
    type: oneOf
    options:
      zip_local: { arguments: [filename], requires: [handler, runtime] }
      zip_s3: { arguments: [s3_bucket, s3_key], optional: [s3_object_version], requires: [handler, runtime] }
      image: { arguments: [image_uri], requires: [] }
    constraints: ["exactly one source", "filename, s3_bucket and image_uri conflict with each other"]
    src: [S1]
    status: verified
  - key: handler
    type: string
    required: "Zip only"
    src: [S1]
    status: verified
  - key: runtime
    type: string
    required: "Zip only"
    constraints: ["must be a supported runtime identifier"]
    src: [S1]
    status: verified
  - key: architectures
    type: enum
    values: [x86_64, arm64]
    default: [x86_64]
    constraints: ["one architecture per function; a container image must target the same one, multi-architecture images are not supported (S5)"]
    src: [S1, S5]
    status: verified
  - key: memory_size
    type: number
    default: 128
    range: [128, 10240]       # AWS limit page. The provider page says 32768, which applies to Managed Instances (S1)
    constraints: ["1 MB steps", "CPU is proportional to memory; 1,769 MB is one vCPU"]
    src: [S1, S2]
    status: verified
  - key: timeout
    type: number
    default: 3
    range: [1, 900]
    src: [S1, S2]
    status: verified
  - key: ephemeral_storage_size
    type: number
    range: [512, 10240]
    constraints: ["/tmp storage, 1 MB steps"]
    src: [S1, S2]
    status: verified
  - key: environment_variables
    type: map
    constraints: ["4 KB in total"]
    src: [S1, S2]
    status: verified
  - key: vpc_config
    type: object
    fields:
      subnet_ids: { required: true }
      security_group_ids: { required: true }
      ipv6_allowed_for_dual_stack: { default: false }
    constraints:
      - "if all fields are empty the block is treated as unset"
      - "attach to private subnets; a public subnet gives no internet access and no public IP"
      - "at least two subnets in different AZs recommended"
      - "cannot attach to a VPC with dedicated tenancy"
    src: [S1, S3, S4]
    status: verified
  - key: role
    type: reference
    ref: iam-role
    required: true
    constraints: ["execution role ARN; needs the VPC access permissions when vpc_config is set"]
    src: [S1, S3]
    status: verified          # see relations/assume-role.md
  - key: reserved_concurrent_executions
    type: number
    default: -1
    constraints: ["0 disables invocation", "-1 removes the reservation"]
    src: [S1]
    status: verified
  - key: layers
    type: list
    constraints: ["at most 5"]
    src: [S1, S2]
    status: verified
  - key: logging_config
    type: object
    fields: { log_format: [Text, JSON], application_log_level: {}, system_log_level: {}, log_group: {} }
    src: [S1]
    status: verified
limits:
  - { id: memory, value: "128 to 10,240 MB", adjustable: false, src: [S2], status: verified }
  - { id: timeout, value: "900 seconds", adjustable: false, src: [S2], status: verified }
  - { id: concurrent_executions, value: 1000, adjustable: true, src: [S2], status: verified, note: "new accounts may start lower" }
  - { id: zip_package, value: "50 MB zipped via API, 250 MB unzipped", adjustable: false, src: [S2], status: verified }
  - { id: image_size, value: "10 GB uncompressed", adjustable: false, src: [S2, S5], status: verified }
  - { id: layers, value: 5, adjustable: false, src: [S2], status: verified }
  - { id: environment_variables, value: "4 KB", adjustable: false, src: [S2], status: verified }
  - { id: payload, value: "6 MB sync, 1 MB async", adjustable: false, src: [S2], status: verified }
  - { id: enis_per_vpc, value: 3000, adjustable: true, src: [S2], status: verified, note: "shared with other services such as EFS" }
  - { id: code_storage, value: "300 GB (zip and layers)", adjustable: false, src: [S2], status: verified }
relations: [containment, sg-attach, egress-path, network-access, listener-target, image-source, assume-role, resource-policy]
cost: { model: usage, notes: "requests and duration; unverified. NAT gateway cost if the function needs the internet from a VPC" }
status: verified
---

# Lambda function

## Purpose

Runs code on demand without servers. Use it for short, stateless, event-driven work: API handlers, scheduled
jobs, file processing. Do not use it for work longer than 15 minutes or for processes that must keep state in
memory between calls.

## Behaviour

- **Default networking.** A function runs in a Lambda-managed VPC with internet access and cannot reach private
  resources in your VPC (S3, S4).
- **Attached to your VPC.** Lambda creates Hyperplane network interfaces in the chosen subnets. After that the
  function reaches only resources in that VPC, unless the VPC itself provides internet access (S3, S4).
- **Internet from a VPC.** Needs private subnets whose route table sends `0.0.0.0/0` to a NAT gateway.
  Connecting to a public subnet does not give internet access or a public IP (S3, S4).
- **Network interfaces.** One is shared by all functions that use the same subnet and security-group
  combination; each supports about 65,000 connections and more are added automatically (S3). A new or updated
  function stays in `Pending` until the interfaces are ready, which can take minutes. If a function is idle for
  14 days Lambda reclaims the interfaces and the function becomes `Inactive`; the next invocation fails while it
  re-enters `Pending` (S3).
- **Removing the VPC configuration** takes up to 20 minutes to delete the interface, and Lambda needs the
  execution role's permissions to do so. Deleting the role first leaves the interface behind (S3).
- **Execution role permissions for the VPC** (`ec2:CreateNetworkInterface`, `DescribeNetworkInterfaces`,
  `DescribeSubnets`, `DeleteNetworkInterface`, `AssignPrivateIpAddresses`, `UnassignPrivateIpAddresses`) come
  from the managed policy `AWSLambdaVPCAccessExecutionRole`. They are only for creating interfaces, not for
  invoking, and they are also granted implicitly to the function's code (S3).
- **Container images.** The ECR repository must be in the same Region as the function. Cross-account images
  are allowed in the same Region. The manifest must be Docker v2 schema 2 or OCI, the uncompressed image at
  most 10 GB, Linux only, one architecture, and it must run on a read-only filesystem apart from `/tmp` (S5).
  The package type of an existing function cannot be changed (S5).
- **Updates.** `code_sha256` triggers updates when the package changes, including changes made outside
  Terraform; `source_code_hash` only reacts to local changes (S1).
- **Invocation by other services** (an ALB, S3, EventBridge) needs a resource-based permission on the function,
  `aws_lambda_permission`, not the execution role (S1).

## Placement

Outside a VPC by default. To reach private resources: private subnets of one VPC, at least two AZs recommended
(S4 builds this layout in its walkthrough), and at least one explicit security group (D-005).

## Relations

- [containment](../relations/containment.md): optional VPC attachment through subnets.
- [sg-attach](../relations/sg-attach.md): `vpc_config.security_group_ids`; required when attached.
- [egress-path](../relations/egress-path.md): NAT gateway for internet access from a VPC.
- [network-access](../relations/network-access.md): as a caller of RDS, EC2 or ECS, only when attached to the VPC (VAL-049).
- [listener-target](../relations/listener-target.md): an ALB may invoke the function as a `lambda` target; needs `aws_lambda_permission`, no VPC involved.
- [image-source](../relations/image-source.md): container image from ECR.
- [assume-role](../relations/assume-role.md): the execution role; required; trusts `lambda.amazonaws.com`; carries
  `AWSLambdaBasicExecutionRole` and, in a VPC, the network interface permissions.
- [grant](../relations/grant.md): what the function may do.
- [resource-policy](../relations/resource-policy.md): who may invoke the function (`aws_lambda_permission`).

## Failure modes

| Situation | Result |
|---|---|
| Attached to a VPC, no NAT gateway, code calls the internet | Calls time out (S4). Rule [VAL-032](../rules/validation.md) |
| Attached to a public subnet | No internet access and no public IP (S3, S4). Rule [VAL-038](../rules/validation.md) |
| Attached to one subnet only | One AZ outage stops the function. Rule [VAL-037](../rules/validation.md) |
| Attached to a VPC with dedicated tenancy | Not supported; peer to a default-tenancy VPC (S3). Rule [VAL-039](../rules/validation.md) |
| `vpc_config` with subnets but no security group, or the reverse | Rejected (S1). Rule [VAL-036](../rules/validation.md) |
| Image in another Region, or multi-architecture | Rejected (S5). Rule [VAL-035](../rules/validation.md) |
| Execution role deleted and recreated after the function exists | `KMSAccessDeniedException` on invocation; switch the role away and back, or recreate the function (S1) |
| Subnet or security group deleted while interfaces remain | Delete waits up to 45 minutes; provider 2.31.0 and later waits automatically (S1) |
| Log group created after the function | Ordering problem; examples use `depends_on` so the log group exists first (S1) |

## Limits, cost, security

See front matter. Security: the function's code can call the EC2 API actions granted for interface management;
add a deny with `lambda:SourceFunctionArn` to prevent it ([SEC-008](../rules/security.md)).

## Terraform mapping

`aws_lambda_function` with `function_name`, `role`, `package_type`, `handler` and `runtime` (zip) or
`image_uri` (image), `architectures`, `memory_size`, `timeout`, `vpc_config { subnet_ids, security_group_ids }`,
`environment`, `logging_config`. Create the log group first. Use `aws_lambda_permission` for invoke access (S1).

## Sources

S1 to S5 in the front matter.

# Sources

Documents used so far. Everything in the networking group was read from these pages. Add a line when a new
page is used.

## AWS documentation

| Topic | URL |
|---|---|
| VPC quotas | https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html |
| VPC CIDR blocks | https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html |
| Subnet CIDR blocks | https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html |
| Subnet route tables (main, custom, association) | https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html |
| Route priority | https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html |
| Internet gateway | https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html |
| Delete an internet gateway | https://docs.aws.amazon.com/vpc/latest/userguide/delete-igw.html |
| NAT gateways | https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html |
| NAT gateway basics | https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html |
| Regional NAT gateways | https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateways-regional.html |
| Elastic IP addresses (basics, quota, pricing) | https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html |
| Gateway endpoints (routing, security, IP types) | https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html |
| Gateway endpoints for S3 (considerations, bucket policies, endpoint policy examples) | https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html |
| Endpoint policies | https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html |
| Security groups | https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html |
| Security group rules | https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html |
| Default security groups | https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html |
| Delete a security group | https://docs.aws.amazon.com/vpc/latest/userguide/deleting-security-groups.html |

### Compute and containers

| Topic | URL |
|---|---|
| EC2 instance IP addressing | https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-instance-addressing.html |
| EC2 instance metadata service | https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html |
| EC2 service quotas | https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-resource-limits.html |
| Lambda quotas | https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html |
| Lambda in a VPC | https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html |
| Lambda internet access from a VPC | https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html |
| Lambda container images | https://docs.aws.amazon.com/lambda/latest/dg/images-create.html |
| ECS Fargate task definition differences, task size | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html |
| ECS Fargate task networking | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html |
| ECS task execution role | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html |
| ECS service quotas (links only) | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-quotas.html |
| ECR service quotas | https://docs.aws.amazon.com/AmazonECR/latest/userguide/service-quotas.html |
| ECR repository policy examples | https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policy-examples.html |

### Storage and databases

| Topic | URL |
|---|---|
| S3 bucket naming rules | https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html |
| S3 Block Public Access | https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html |
| S3 default encryption | https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-bucket-encryption.html |
| S3 Object Ownership | https://docs.aws.amazon.com/AmazonS3/latest/userguide/ensure-object-ownership.html |
| S3 bucket quotas and restrictions | https://docs.aws.amazon.com/AmazonS3/latest/userguide/BucketRestrictions.html |
| S3 bucket policies | https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html |
| CloudFront origin access control for S3 | https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html |
| ALB access logs bucket | https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html |
| RDS in a VPC and DB subnet groups | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html |
| RDS quotas and naming constraints | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html |
| RDS Multi-AZ (overview page only) | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html |
| RDS encryption | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html |
| RDS master password in Secrets Manager | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html |

### Delivery and certificates

| Topic | URL |
|---|---|
| Application Load Balancers | https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html |
| ALB quotas | https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-limits.html |
| ALB target groups | https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html |
| ALB HTTPS listener | https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html |
| Route 53 alias vs non-alias records | https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html |
| Route 53 quotas | https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/DNSLimitations.html |
| Route 53 to CloudFront | https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html |
| Route 53 to an ELB | https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-elb-load-balancer.html |
| CloudFront certificate requirements | https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html |
| CloudFront quotas | https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html |
| ACM DNS validation | https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html |
| ACM quotas | https://docs.aws.amazon.com/acm/latest/userguide/acm-limits.html |
| ACM integrated services | https://docs.aws.amazon.com/acm/latest/userguide/acm-services.html |

### IAM

| Topic | URL |
|---|---|
| IAM and STS quotas | https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html |
| Roles for AWS services | https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-service.html |
| Instance profiles | https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2_instance-profiles.html |
| iam:PassRole | https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html |
| Policy evaluation logic | https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html |
| IAM best practices | https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html |
| Lambda execution role | https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html |
| ECS task IAM role | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html |

## Terraform AWS provider documentation (tag v6.66.0, read as raw markdown)

Base: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/

`vpc`, `subnet`, `internet_gateway`, `nat_gateway`, `eip`, `route_table`, `route`, `route_table_association`,
`security_group`, `vpc_security_group_ingress_rule`, `instance`, `lambda_function`, `ecs_cluster`,
`ecs_task_definition`, `ecs_service`, `ecr_repository`, `ecr_lifecycle_policy`, `s3_bucket`,
`s3_bucket_public_access_block`, `s3_bucket_policy`, `s3_bucket_server_side_encryption_configuration`,
`s3_bucket_versioning`, `s3_bucket_ownership_controls`, `s3_bucket_lifecycle_configuration`, `db_instance`,
`db_subnet_group`, `lambda_permission`, `lb`, `lb_listener`, `lb_target_group`, `lb_target_group_attachment`,
`route53_zone`, `route53_record`, `cloudfront_distribution`, `cloudfront_origin_access_control`, `acm_certificate`,
`acm_certificate_validation`, `iam_role`, `iam_role_policy`, `iam_role_policy_attachment`, `iam_policy`, `iam_instance_profile`, `vpc_endpoint`, `vpc_endpoint_route_table_association`, `eip`, `eip_association` (the last two read at tag `v6.66.0`)
(each with `.html.markdown`) and the data source `aws_iam_policy_document` (`d/iam_policy_document.html.markdown`).

All pages were first read from the `main` branch. On 23 October 2026 each of the 52 pages used (including the `aws_default_*` pages) was
downloaded at `main` and at the pinned tag `v6.66.0` and compared line by line. 31 are identical. The other 21 differ only in
wording, capitalisation, new import examples and experimental notes, except for these three points, which are now recorded:

- `aws_lambda_function`: inside the `ephemeral_storage` block `size` is Required at `v6.66.0` and Optional on `main`.
- `aws_ecs_service`: capacity provider `weight` and the linear and canary deployment percentages are Required at `v6.66.0` and
  Optional on `main`; capacity provider strategies and these deployment types are out of scope.
- `aws_db_instance`: at `v6.66.0` the `password_wo` argument says it "will be stored in the state file", which contradicts its
  write-only nature and which `main` removed. The specification keeps the write-only behaviour and marks it `unverified`.

Every provider URL in the specification now points at `v6.66.0`.

## Not yet checked

- EC2 On-Demand vCPU quota defaults, ECS cluster/service/task quotas (pages read did not list numbers).
- The ECS capacity provider resource, and whether the ECS service-linked role must be created in Terraform.
- Whether an ECS image pull across Regions works and which Regions are recommended.
- EC2 AMI and instance type architecture matching, and AMI Region rules.
- RDS: Multi-AZ failover timing and engine-level behaviour (the Multi-AZ page read was an index), allocated storage
  ranges per engine and storage type, engine default ports, engine-specific username and database-name rules.
- S3: whether a public access block and a bucket policy race in Terraform, the exact SSE-C default-block date, and
  whether same-account access needs only one of the identity or resource policy for S3 specifically.
- Lambda permission: whether S3 as a principal needs `source_account`, and the principals for the other triggers
  (the ALB principal `elasticloadbalancing.amazonaws.com` is verified from the target group attachment page).
- ALB: that internet-facing needs public subnets and the same-Region rule for certificates (stated nowhere in the pages
  read); the listener rule resource, WAF and authentication actions (out of scope); the security group
  recommendation page returned no content, so the SG rule shape is derived from the overview page.
- Route 53: the CloudFront alias hosted zone ID constant and the exported attribute names of the load balancer and the
  distribution used by an alias; the ELB zone ID attribute.
- CloudFront: managed cache policy IDs and data sources, the origin-facing managed prefix list, the distribution's
  exported attributes, and the exact behaviour of `minimum_protocol_version` with the default certificate (the provider
  page contradicts itself).
- IAM: the ARN paths of `AWSLambdaVPCAccessExecutionRole`, `AmazonRDSEnhancedMonitoringRole` and
  `AmazonSSMManagedInstanceCore`; the RDS IAM authentication action and resource format; the S3 `DeleteObject` action;
  whether an identity policy must not carry a `Principal`; propagation delay for a new role; the policy version
  limit; the `aws_iam_service_linked_role` resource and whether the ECS service-linked role must be created in
  Terraform; the `aws_caller_identity` data source; the list of IAM Access Analyzer checks.
- ACM: the ALB same-Region rule, `key_algorithm` values, and whether consumers should reference the certificate or the
  validation resource.
- Terraform Registry pages for the pinned version.
- AWS pricing pages (NAT gateway, Elastic IP and public IPv4 address charges).
- DNS attributes of a VPC (`vpc-dns` page was found but its detail was not read).
- Network ACLs.
- Latest AWS provider and OpenTofu release numbers (only unofficial listings were found).
- VPC gateway endpoint for S3: whether the endpoint quota of 255 per VPC can be raised, whether `service_name`, `vpc_id` and `vpc_endpoint_type` force replacement, whether the endpoint route counts toward the routes-per-table quota, how the route appears in `aws_route_table` state, and the behaviour of a network ACL (out of scope, D-008).
- `aws_default_route_table` and `aws_default_network_acl` were downloaded for the comparison but not read for design (D-006 leaves both untouched).
- Elastic IP: the Public IPv4 price, whether a NAT gateway keeps its address on replacement, and `aws_nat_gateway.secondary_allocation_ids` as a second connection from an Elastic IP.

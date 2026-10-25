# Terraform resource map

What each service and mechanism generates. Networking group only for now. Pitfalls referenced are in
[pitfalls.md](pitfalls.md). Provider `~> 6.66.0` (decision D-001).

## Services

| Service | Resource(s) | Key arguments emitted | Notes |
|---|---|---|---|
| vpc | `aws_vpc`, `aws_default_security_group` | `cidr_block`, `enable_dns_support`, `enable_dns_hostnames`, `instance_tenancy`, `tags`; default group: `vpc_id` and no rules | Also creates default route table, security group, network ACL (P-013); the default group is emptied (P-078 to P-080, decision D-006) |
| subnet | `aws_subnet` | `vpc_id`, `cidr_block`, `availability_zone`, `map_public_ip_on_launch`, `tags` | |
| internet-gateway | `aws_internet_gateway` | `vpc_id`, `tags` | P-009 |
| elastic-ip | `aws_eip`, `aws_eip_association` (EC2 only) | EIP: `domain = "vpc"`, `tags`, `depends_on` the internet gateway. Association: `allocation_id`, `instance_id` | P-007, P-008, P-075 to P-077; decision D-007 |
| nat-gateway (zonal, public) | `aws_nat_gateway` | `allocation_id` (from the elastic-ip), `subnet_id`, `connectivity_type`, `depends_on` | P-007, P-008 |
| nat-gateway (regional) | `aws_nat_gateway` | `availability_mode = "regional"`, `vpc_id` | P-014; decision D-002 |
| vpc-endpoint-s3 | `aws_vpc_endpoint`, `aws_vpc_endpoint_route_table_association` | endpoint: `vpc_id`, `service_name = "com.amazonaws.<region>.s3"`, `vpc_endpoint_type = "Gateway"`, `policy`. Association: `route_table_id`, `vpc_endpoint_id` | P-070 to P-074; decision D-029 |
| route-table | `aws_route_table` | `vpc_id`, `tags` (no inline `route`) | P-001 |
| security-group | `aws_security_group` | `name`, `description`, `vpc_id`, `tags` (no inline rules) | P-002, P-003, P-005, P-006 |

### Compute and containers

| Service | Resource(s) | Key arguments emitted | Notes |
|---|---|---|---|
| ec2 | `aws_instance` | `ami`, `instance_type`, `subnet_id`, `vpc_security_group_ids`, `associate_public_ip_address`, `iam_instance_profile`, `key_name`, `user_data`, `metadata_options { http_tokens = "required" }`, `root_block_device { encrypted = true }`, `tags` | P-018 to P-022 |
| lambda | `aws_lambda_function`, `aws_cloudwatch_log_group` | `function_name`, `role`, `package_type`, `handler`/`runtime` or `image_uri`, `architectures`, `memory_size`, `timeout`, `vpc_config { subnet_ids, security_group_ids }`, `environment`, `logging_config` | P-023 to P-027. Invoke permission via `aws_lambda_permission` |
| ecs | `aws_ecs_cluster`, `aws_ecs_task_definition`, `aws_ecs_service` | cluster `name`; task definition `family`, `cpu`, `memory`, `network_mode = "awsvpc"`, `requires_compatibilities = ["FARGATE"]`, `runtime_platform`, `execution_role_arn`, `task_role_arn`, `container_definitions`; service `cluster`, `task_definition`, `desired_count`, `launch_type = "FARGATE"`, `network_configuration`, `load_balancer` | P-028 to P-032 |
| ecr | `aws_ecr_repository`, `aws_ecr_lifecycle_policy` | `name`, `image_tag_mutability`, `image_scanning_configuration`, `encryption_configuration`, `force_delete`; policy `repository`, `policy` | P-033 |

### Storage and databases

| Service | Resource(s) | Key arguments emitted | Notes |
|---|---|---|---|
| s3 | `aws_s3_bucket`, `aws_s3_bucket_public_access_block`, `aws_s3_bucket_ownership_controls`, `aws_s3_bucket_versioning`, `aws_s3_bucket_server_side_encryption_configuration`, `aws_s3_bucket_lifecycle_configuration`, `aws_s3_bucket_policy` | bucket `bucket`, `force_destroy`, `tags`; access block all four `true`; ownership `BucketOwnerEnforced`; versioning `Enabled`; encryption `AES256` unless a key is chosen; one lifecycle resource; one policy | P-035 to P-038, P-043, P-044. No inline arguments on the bucket |
| db-subnet-group | `aws_db_subnet_group` | `name`, `description`, `subnet_ids` (the subnets drawn into the group), `tags` | one group per node; several instances may use it |
| rds | `aws_db_instance` | instance `db_subnet_group_name`, `identifier`, `engine`, `engine_version`, `instance_class`, `allocated_storage`, `storage_type`, `storage_encrypted = true`, `db_name`, `username`, `manage_master_user_password = true`, `db_subnet_group_name`, `vpc_security_group_ids`, `publicly_accessible = false`, `multi_az`, `backup_retention_period`, `deletion_protection`, `skip_final_snapshot`, `final_snapshot_identifier`, `tags` | P-039 to P-042 |

### Delivery and certificates

| Service | Resource(s) | Key arguments emitted | Notes |
|---|---|---|---|
| alb | `aws_lb`, `aws_lb_listener`, `aws_lb_target_group`, `aws_lb_target_group_attachment` | `load_balancer_type = "application"`, `internal`, `subnets`, `security_groups`, `drop_invalid_header_fields = true`, `access_logs`; listener `protocol`, `port`, `ssl_policy`, `certificate_arn`, `default_action`; target group `target_type`, `port`, `protocol`, `vpc_id`, `health_check` | P-045 to P-047, P-059 |
| route53 | `aws_route53_zone`, `aws_route53_record` | zone `name`, `force_destroy = false`; record `zone_id`, `name`, `type`, `alias { name, zone_id, evaluate_target_health }` or `ttl` and `records` | P-053 to P-058 |
| cloudfront | `aws_cloudfront_distribution`, `aws_cloudfront_origin_access_control` | `enabled`, `aliases`, `origin`, `default_cache_behavior { viewer_protocol_policy = "redirect-to-https", cache_policy_id }`, `viewer_certificate { acm_certificate_arn, ssl_support_method = "sni-only", minimum_protocol_version = "TLSv1.2_2021" }`, `restrictions`; OAC `signing_behavior = "always"`, `signing_protocol = "sigv4"` | P-050 to P-052, P-057 |
| acm | `aws_acm_certificate`, `aws_acm_certificate_validation` | `domain_name`, `subject_alternative_names`, `validation_method = "DNS"`, `create_before_destroy`; validation `certificate_arn`, `validation_record_fqdns` | P-048, P-049, P-051; a `us-east-1` provider alias for CloudFront |

### IAM

| Service | Resource(s) | Key arguments emitted | Notes |
|---|---|---|---|
| iam-role | `aws_iam_role`, `aws_iam_role_policy_attachment`, `aws_iam_role_policy`, `aws_iam_instance_profile` | role `name`, `assume_role_policy`, `description`, `tags`; attachment `role`, `policy_arn`; inline `name`, `role`, `policy`; profile `name`, `role` (EC2 only) | P-060 to P-063, P-066 to P-068. No inline or managed arguments on the role |
| iam-policy | `aws_iam_policy`, `data.aws_iam_policy_document` | `name`, `description`, `policy` from the data source's `json` | P-064, P-065, P-069 |

## Mechanisms

| Mechanism | Resource | Key arguments emitted |
|---|---|---|
| containment | none of its own | `vpc_id`, `subnet_id` references on the child |
| igw-attach | none of its own | `aws_internet_gateway.vpc_id` |
| route | `aws_route` for an internet or NAT gateway; `aws_vpc_endpoint_route_table_association` for the S3 endpoint | `route_table_id`, `destination_cidr_block`, `gateway_id` (internet gateway) or `nat_gateway_id` (NAT gateway); for the endpoint `route_table_id`, `vpc_endpoint_id` |
| route-association | `aws_route_table_association` | `subnet_id`, `route_table_id` |
| nat-placement | none of its own | `aws_nat_gateway.subnet_id`, `depends_on` |
| eip-attach | `aws_eip_association` for EC2; none for a NAT gateway | NAT: `aws_nat_gateway.allocation_id = aws_eip.<x>.id`. EC2: `allocation_id`, `instance_id` |
| sg-attach | none of its own | `vpc_security_group_ids` (ec2), `vpc_config.security_group_ids` (lambda), `network_configuration.security_groups` (ecs); alb and rds pending |
| image-source | none of its own | `image` in the container definition (ecs), `image_uri` and `package_type = "Image"` (lambda); pull permission is a grant on the consumer's role |
| assume-role | `aws_iam_role` trust policy, `aws_iam_instance_profile`, the consumer's role argument | EC2 `iam_instance_profile` (name); Lambda `role` (ARN); ECS `task_role_arn` and `execution_role_arn`; RDS `monitoring_role_arn`. Required managed policies attached through `aws_iam_role_policy_attachment` |
| grant | `aws_iam_role_policy` named `grants` | statements from the grant registry, `sid` per target and level, exact ARNs |
| listener-target | `aws_lb_target_group`, `aws_lb_listener` default action, `aws_lb_target_group_attachment` (EC2, Lambda), ECS service `load_balancer` block, `aws_lambda_permission` | target type follows the target: `instance` for EC2, `ip` for ECS Fargate, `lambda` for Lambda |
| origin | `aws_cloudfront_origin_access_control`, distribution `origin`, bucket policy statement | S3: `origin_access_control_id` and the regional domain name; ALB: `custom_origin_config` |
| dns-alias | `aws_route53_record` | A alias, plus AAAA when the distribution has IPv6 on |
| cert-attach | listener `certificate_arn` (+ `aws_lb_listener_certificate`), distribution `viewer_certificate` | CloudFront certificate in `us-east-1` |
| cert-validation | `aws_route53_record` (CNAME), `aws_acm_certificate_validation` | one record per distinct record name |
| db-subnet-group | `aws_db_instance.db_subnet_group_name` | the name of the group the instance is drawn to |
| resource-policy | `aws_s3_bucket_policy`, `aws_lambda_permission`, `aws_ecr_repository_policy` | one bucket policy per bucket with merged statements; one Lambda permission per invoker (`action`, `function_name`, `principal`, `source_arn`) |
| network-access | `aws_vpc_security_group_ingress_rule` (+ egress when needed) | `security_group_id` = callee group, `referenced_security_group_id` = caller group, port from the callee |
| egress-path | none | derived from routes, associations, gateways and addresses |
| sg-reference | `aws_vpc_security_group_ingress_rule` / `..._egress_rule` | `security_group_id`, `referenced_security_group_id`, `ip_protocol`, `from_port`, `to_port`, `description` |
| (security group rules) | `aws_vpc_security_group_ingress_rule` / `..._egress_rule` | one resource per rule and per port range; peer is one of `cidr_ipv4`, `cidr_ipv6`, `prefix_list_id`, `referenced_security_group_id` |

## Ordering the generator relies on

1. `aws_vpc`
2. `aws_internet_gateway`, `aws_subnet`, `aws_security_group`, `aws_route_table`
3. `aws_eip`, then `aws_nat_gateway` (after the internet gateway); `aws_eip_association` after the instance
4. `aws_route`, `aws_route_table_association`, `aws_vpc_endpoint` then `aws_vpc_endpoint_route_table_association`, security group rules (the S3 egress rule uses the endpoint's `prefix_list_id`)
5. Resources placed in subnets

Terraform derives this from attribute references. Add `depends_on` only where a reference does not exist but
the dependency does (EIP and NAT gateway on the internet gateway, P-007).

## Pending

Attachments to compute, database and load balancer resources are added with their services.

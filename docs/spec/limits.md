# Limits

Quotas that affect design validity. Source for every row below:
https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html unless another is given. All values are
defaults per Region, status `verified`. Check Service Quotas for the actual value of an account, because most
are adjustable.

The platform should hold these as configurable settings, not constants, so a user with raised quotas is not
blocked.

## Networking

| ID | Default | Adjustable | Notes |
|---|---|---|---|
| vpcs_per_region | 5 | yes | Raising it raises internet gateways per Region equally |
| subnets_per_vpc | 200 | yes | |
| ipv4_cidr_blocks_per_vpc | 5 | yes, up to 50 | Primary plus secondary |
| route_tables_per_vpc | 200 | yes | Main route table counts |
| routes_per_route_table | 500 | yes, up to 1000 | Non-propagated; IPv4 and IPv6 counted separately |
| propagated_routes_per_route_table | 100 | no | |
| internet_gateways_per_region | 5 | yes | Tied to VPC quota; one per VPC |
| nat_gateways_per_az | 5 | yes | Counts pending, active and deleting |
| eips_per_region | 5 | yes | Shared with all Elastic IPs (NAT gateways and instances); addresses from a bring-your-own pool do not count. See [elastic-ip](services/elastic-ip.md) |
| eips_per_public_nat_gateway | 2 | yes, up to 8 | |
| security_groups_per_region | 2500 | yes | |
| rules_per_security_group | 60 | yes | Per direction and per IP family. Times groups per interface must not exceed 1000 |
| security_groups_per_network_interface | 5 | yes, up to 16 | |
| network_interfaces_per_region | 5000 | yes | Enforced per AZ |
| gateway_endpoints_per_region | 20 | yes | Counts every gateway endpoint (S3 and DynamoDB) |
| gateway_endpoints_per_vpc | 255 | unverified | |
| s3_endpoint_routes_per_route_table | 1 | no | A table cannot have two endpoint routes to the same service |
| endpoint_policy_size | 20480 characters | no | Including white space |

## NAT gateway throughput

Source: https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html. 5 Gbps scaling to 100 Gbps,
1 million packets per second scaling to 10 million, 55,000 simultaneous connections per IP per unique
destination. Not adjustable.

## Name and text limits

Source: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html. Security group name and
description: 255 characters. Security group rule description: 255 characters.

## Compute and containers

Status `verified` unless noted. Sources: the AWS pages named in each service file.

| ID | Default | Adjustable | Notes |
|---|---|---|---|
| ec2 on-demand vCPUs | per instance family group, depends on the account | yes | The numeric defaults were not read; check Service Quotas (https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-resource-limits.html). Status `unverified` for the numbers |
| ec2 outbound port 25 | blocked to public addresses | removal on request | Same page |
| lambda concurrent executions | 1,000 | yes | New accounts may start lower. https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html |
| lambda memory | 128 to 10,240 MB | no | The provider page lists 32,768 MB for Managed Instances; not used here |
| lambda timeout | 900 s | no | |
| lambda package, zip | 50 MB zipped via API, 250 MB unzipped including layers | no | |
| lambda package, image | 10 GB uncompressed | no | |
| lambda layers | 5 | no | |
| lambda environment variables | 4 KB total | no | |
| lambda payload | 6 MB synchronous, 1 MB asynchronous | no | |
| lambda code storage | 300 GB | no | Use self-managed S3 code storage beyond it |
| lambda ENIs per VPC | 3,000 | yes | Shared with other services such as EFS |
| ecs subnets per awsvpc configuration | 16 | no | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html |
| ecs security groups per awsvpc configuration | 5 | no | |
| ecs ENIs per task | 1 | no | |
| ecs cluster, service and task quotas | not read | yes | The quotas page links to the General Reference. Status `unverified` |
| ecs Fargate task sizes | see table in [services/ecs.md](services/ecs.md) | no | |
| ecr repositories per Region | 100,000 | yes | https://docs.aws.amazon.com/AmazonECR/latest/userguide/service-quotas.html |
| ecr images per repository | 100,000 | yes | |
| ecr lifecycle rules per policy | 50 | no | |
| ecr lifecycle policy length | 30,720 characters | no | |
| ecr maximum layer size | 52,000 MiB | no | |
| ecr tags per image | 1,000 | no | |
| ecr pull and auth API rates | BatchGetImage 2,000/s, GetDownloadUrlForLayer 3,000/s, GetAuthorizationToken 500/s | yes | Large fleets starting at once can reach them |

## Storage and databases

Status `verified` unless noted. Sources: S3 https://docs.aws.amazon.com/AmazonS3/latest/userguide/BucketRestrictions.html, RDS https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html.

| ID | Default | Adjustable | Notes |
|---|---|---|---|
| s3 buckets per account | 10,000 | yes | Commercial-Region quotas are managed from US East (N. Virginia) |
| s3 bucket size, object count | no limit | not applicable | |
| s3 bucket policy size | 20 KB | no | https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/s3_bucket_policy.html.markdown |
| s3 bucket name length | 3 to 63 characters | no | https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html |
| s3 lifecycle rule id | 255 characters | no | |
| rds DB instances per Region | 40 (20 in ap-south-1) | yes | Shared with Aurora, Neptune, DocumentDB |
| rds DB subnet groups | 50 (20 in ap-south-1) | yes | |
| rds subnets per DB subnet group | 20 | no | |
| rds read replicas per primary | 15 | yes | |
| rds manual snapshots | 100 | yes | |
| rds total storage | 100,000 GB | yes | Not applied to Aurora |
| rds IAM roles per DB instance | 5 | yes | |
| rds identifier length | 63 | no | |
| rds master password length | MySQL 8 to 41, PostgreSQL 8 to 128 | no | |
| rds allocated storage ranges per engine | not read | | Status `unverified` |

## Delivery and certificates

Status `verified`. Sources: ALB https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-limits.html,
Route 53 https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/DNSLimitations.html, CloudFront
https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html, ACM
https://docs.aws.amazon.com/acm/latest/userguide/acm-limits.html.

| ID | Default | Adjustable | Notes |
|---|---|---|---|
| alb per Region | 50 | yes | |
| alb listeners per ALB | 50 | yes | |
| alb rules per ALB | 100 | yes | Excluding default rules |
| alb extra certificates per ALB | 25 | yes | Excluding default certificates |
| alb target groups per ALB | 100 (5 per action) | no | |
| alb targets per ALB | 1,000 | yes | |
| alb target groups per Region | 3,000 | yes | Shared with network load balancers |
| alb targets per target group | 1,000 instances or IPs; 1 Lambda function | instances and IPs | |
| alb load balancers per target group | 1 | no | |
| alb request line, single header, request header | 16 K, 16 K, 64 K | no | |
| alb name length | 32 | no | https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lb.html.markdown |
| route53 hosted zones | 500 | yes | Quotas are managed from US East (N. Virginia) |
| route53 records per zone | 10,000 | yes | An extra charge applies above it |
| route53 records per record set | 400 | no | |
| route53 change request | 1,000 elements, 32,000 characters | no | UPSERT counts twice |
| route53 health checks | 200 | yes | |
| cloudfront distributions per account | 500 | yes | |
| cloudfront aliases per distribution | 100 | yes | |
| cloudfront origins per distribution | 100 | yes | |
| cloudfront cache behaviours per distribution | 75 | yes | |
| cloudfront origin access controls per account | 100 | yes | An OAC can serve 100 distributions |
| cloudfront certificates per distribution | 1 | no | Dedicated-IP certificates: 2 per account by default |
| cloudfront custom headers added to origin requests | 30 | yes | |
| cloudfront custom cache policies | 20 | yes | |
| cloudfront cacheable object | 50 GB per GET response | no | |
| cloudfront invalidation rate | 150 paths per second; 1 wildcard per second | no | |
| acm certificates per Region | 2,500 | yes | Expired and revoked ones count |
| acm certificates per year | 5,000 | yes | Per Region and account |
| acm domain names per certificate | 10 | yes, up to 100 | |
| acm DNS validation timeout | 72 hours | no | |

## IAM

Status `verified`. Source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html.

| ID | Default | Adjustable | Notes |
|---|---|---|---|
| iam roles per account | 1,000 | yes, up to 10,000 | |
| iam instance profiles per account | 1,000 | yes, up to 10,000 | |
| iam customer managed policies per account | 1,500 | yes, up to 10,000 | |
| iam managed policies per role | 20 | yes, up to 25 | |
| iam roles per instance profile | 1 | no | Cannot be increased |
| iam role trust policy length | 2,048 characters | yes, up to 8,192 | |
| iam inline policies on a role, total | 10,240 characters | no | White space not counted |
| iam managed policy size | 6,144 characters | no | White space not counted |
| iam role name | 64 characters | no | Path plus name 64 for the console switch-role feature |
| iam instance profile name, policy name | 128 characters | no | |
| iam path | 512 characters | no | |
| iam role session duration | 1 to 12 hours | no | Not applied to sessions assumed by AWS services |
| sts requests | 600 per second per account per Region | by support case | Service principals do not use it |

## Complete

Limits for every Tier 1 group are now listed.

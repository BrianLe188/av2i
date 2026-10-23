# Relation mechanisms

A mechanism is a kind of connection between resources. The matrix and the rules refer to mechanisms by ID. The
detail of each lives in `relations/<id>.md`, written after the services it involves.

Every entry below is `unverified` until its detail file is written and checked against the AWS and Terraform
documentation. Treat the participants and notes as the working hypothesis to confirm.

## Catalogue

| ID | Participants | Direction | What it means | Generates (Terraform) |
|---|---|---|---|---|
| `containment` | vpc, subnet, then placed resources | parent to child | A resource lives inside a VPC or subnet | `vpc_id`, `subnet_id` / `subnet_ids` on the child |
| `igw-attach` | internet-gateway, vpc | undirected | The VPC can reach the internet through the gateway | `aws_internet_gateway.vpc_id` |
| `route` | route-table, internet-gateway, nat-gateway or vpc-endpoint-s3 | route-table to target | A default or specific route sends traffic to a gateway, or a table is associated with the S3 gateway endpoint | `aws_route`, or `aws_vpc_endpoint_route_table_association` for the endpoint |
| `route-association` | route-table, subnet | undirected | A subnet uses the route table; this decides public or private | `aws_route_table_association` |
| `nat-placement` | nat-gateway, subnet | child to parent | A NAT gateway sits in a public subnet and needs an Elastic IP | `aws_nat_gateway.subnet_id`, `aws_eip` |
| `sg-attach` | security-group, ec2 / ecs / rds / alb / lambda | undirected | A security group guards a resource's network interface | `vpc_security_group_ids` or `security_groups` |
| `sg-reference` | security-group, security-group | a to b | A rule allows traffic from or to another group instead of a CIDR | `referenced_security_group_id` on the rule |
| `network-access` | ec2 / lambda / ecs, rds; alb, ec2 / ecs | caller to callee | One workload may reach another on a port; implemented as security group rules | ingress rule on the callee's group |
| `egress-path` | ec2 / ecs / lambda, route-table, internet-gateway, nat-gateway | derived | Whether a workload can reach the internet or AWS public endpoints, from placement, routes and addresses. Reported, not drawn | none of its own |
| `db-subnet-group` | rds, subnet (two or more) | rds to subnets | RDS needs subnets in at least two availability zones | `aws_db_subnet_group` |
| `listener-target` | alb, ec2 / ecs (and lambda) | alb to target | The load balancer forwards listener traffic to a target group | `aws_lb_listener`, `aws_lb_target_group`, attachment |
| `assume-role` | iam-role, ec2 / lambda / ecs | role to consumer | A service runs as a role; the trust policy names who may assume it | `aws_iam_role` trust policy, instance profile, `role`, `task_role_arn`, `execution_role_arn` |
| `grant` | iam-role, s3 / ecr / rds (and later more) | role to target | The role may perform a set of actions on the target | `aws_iam_role_policy` statements |
| `resource-policy` | s3, cloudfront / alb / lambda / ecr | target to principal | A policy on the resource itself allows another principal, with no role involved | `aws_s3_bucket_policy`, `aws_lambda_permission`, `aws_ecr_repository_policy` |
| `image-source` | ecr, ecs / lambda | ecr to consumer | A container service pulls its image from a repository; needs pull permission | `image` argument plus a `grant` on the execution role |
| `origin` | cloudfront, s3 / alb | cloudfront to origin | A distribution fetches content from an origin | `origin` block, origin access control |
| `dns-alias` | route53, alb / cloudfront / s3 | record to target | A DNS name points at the target | `aws_route53_record` alias |
| `cert-attach` | acm, alb / cloudfront | acm to consumer | A certificate secures a listener or distribution; has regional rules | `certificate_arn`, `viewer_certificate` |
| `cert-validation` | acm, route53 | acm to zone | A certificate proves domain ownership through a DNS record | `aws_acm_certificate_validation`, validation record |

## Notes that shape the model

These come from general AWS knowledge and each needs checking (`unverified`).

1. **`containment` is not a connection a user draws.** It comes from nesting, and it fixes the VPC a resource
   belongs to. Every mechanism that says `same_vpc` is checked against it.
2. **Public or private is a property of the route table, not of the subnet.** A subnet is public when its
   associated route table has a route to an internet gateway. Mechanisms that need a public or private subnet
   (`nat-placement`, `listener-target` for an internet-facing ALB) are validated through `route` and
   `route-association`.
3. **`network-access` is derived, not primary.** It is the cause; `sg-attach` plus `sg-reference` rules are the
   effect. The spec must say which one the user chooses and which the platform generates.
4. **`assume-role` and `grant` are separate on purpose.** Who runs as a role and what the role may do change
   independently. A resource that needs no AWS permissions has no role at all, so `assume-role` is optional.
5. **`resource-policy` is not IAM-role based.** CloudFront reading S3 and ALB writing access logs use a policy
   on the target. Modelling them as `grant` would be wrong.
6. **Several mechanisms have regional or ordering rules.** For example a CloudFront certificate must be in
   `us-east-1`, and a security group cannot be deleted while attached. These go in the detail files under
   Failure modes and in `terraform/pitfalls.md`.
7. **Mechanisms are open for extension.** Adding a service later (SQS, DynamoDB, Secrets Manager) means adding
   participants to `assume-role`, `grant` or `resource-policy`, or adding a mechanism such as `event-source` or
   `secret-reference`. It should not mean changing existing ones.

## Detail files written so far

`containment`, `igw-attach`, `route`, `route-association`, `nat-placement`, `sg-attach`, `sg-reference`,
`network-access`, `egress-path`, `image-source`, `db-subnet-group`, `resource-policy` (S3 bucket policy in full,
Lambda permission and ECR policy in outline), `listener-target`, `origin`, `dns-alias`, `cert-attach`,
`cert-validation`, `assume-role`, `grant`. All mechanisms in the catalogue now have a detail file.

## Order of detail files

1. `containment`, `igw-attach`, `route`, `route-association`, `nat-placement`
2. `sg-attach`, `sg-reference`, `network-access`
3. `db-subnet-group`, `listener-target`, `image-source`
4. `assume-role`, `grant`, `resource-policy`
5. `origin`, `dns-alias`, `cert-attach`, `cert-validation`

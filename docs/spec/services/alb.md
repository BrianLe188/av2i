---
id: alb
title: { vi: "ALB (cân bằng tải ứng dụng)", en: "Application Load Balancer (ALB)" }
terraform:
  resources: [aws_lb, aws_lb_listener, aws_lb_target_group, aws_lb_target_group_attachment]
scope: vpc
placement:
  requires: [vpc, subnet]
  subnet_type: public          # internet-facing; private for internal (see cases)
  min_azs: 2
sources:
  S1: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lb.html.markdown
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lb_listener.html.markdown
  S3: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lb_target_group.html.markdown
  S4: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lb_target_group_attachment.html.markdown
  S5: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
  S6: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-limits.html
  S7: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html
  S8: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html
  S9: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html
scope_note: "Application Load Balancer only. Network and Gateway load balancers, listener rules, authentication actions (Cognito, OIDC, JWT), mutual TLS, WAF, IPAM pools, Local Zone and Outpost subnets, weighted target groups, gRPC and HTTP/2 to targets, target optimizer and dual-stack are out of scope (decision D-019)"
parts:
  load_balancer:
    - { key: name, type: string, required: true, force_new: unverified, constraints: ["up to 32 characters", "alphanumeric or hyphens only", "no leading or trailing hyphen", "unique in the account"], src: [S1, S6], status: verified }
    - { key: internal, type: boolean, default: false, constraints: ["true makes it an internal load balancer"], src: [S1], status: verified }
    - { key: subnets, type: list, ref: subnet, required: true, constraints: ["at least two, each in a different Availability Zone", "all enabled zones of the same type", "each subnet at least /27 with at least 8 free addresses"], src: [S1, S5], status: verified }
    - { key: security_groups, type: list, ref: security-group, required: true, constraints: ["rules must allow traffic in both directions on the listener ports and the health check ports", "explicit group required (D-005)"], src: [S1, S5], status: verified }
    - { key: ip_address_type, type: enum, values: [ipv4], default: ipv4, constraints: ["dualstack variants are out of scope"], src: [S1, S5], status: verified }
    - { key: idle_timeout, type: number, default: 60, unit: seconds, src: [S1], status: verified }
    - { key: enable_deletion_protection, type: boolean, default: false, constraints: ["true blocks deletion through the API so Terraform cannot delete it"], src: [S1], status: verified }
    - { key: drop_invalid_header_fields, type: boolean, default: false, src: [S1, S5], status: verified }
    - { key: enable_http2, type: boolean, default: true, src: [S1, S5], status: verified }
    - { key: desync_mitigation_mode, type: enum, values: [monitor, defensive, strictest], default: defensive, src: [S1, S5], status: verified }
    - { key: preserve_host_header, type: boolean, default: false, src: [S1, S5], status: verified }
    - { key: xff_header_processing_mode, type: enum, values: [append, preserve, remove], default: append, src: [S1, S5], status: verified }
    - { key: client_keep_alive, type: number, default: 3600, range: [60, 604800], src: [S1], status: verified }
    - { key: access_logs, type: object, fields: { bucket: required, enabled: { default: false, note: "false even when a bucket is set" }, prefix: {} }, constraints: ["bucket rules in resource-policy and VAL-055"], src: [S1, S9], status: verified }
    - { key: enable_cross_zone_load_balancing, type: boolean, default: true, constraints: ["always on for application load balancers, cannot be turned off at this level"], src: [S1, S5], status: verified }
    - { key: tags, type: map, src: [S1], status: verified }
  listener:
    - { key: load_balancer_arn, type: reference, ref: alb, required: true, force_new: true, src: [S2], status: verified }
    - { key: port, type: number, constraints: ["1 to 65535"], src: [S2], status: verified }
    - { key: protocol, type: enum, values: [HTTP, HTTPS], default: HTTP, src: [S2], status: verified }
    - { key: ssl_policy, type: string, default: "ELBSecurityPolicy-2016-08", constraints: ["required for HTTPS", "the HTTPS guide's example uses ELBSecurityPolicy-TLS13-1-2-2021-06"], src: [S2, S8], status: verified }
    - { key: certificate_arn, type: reference, ref: acm, constraints: ["exactly one default certificate for HTTPS; more through aws_lb_listener_certificate", "ED25519 keys are not supported"], src: [S2, S8], status: verified }
    - { key: default_action, type: object, required: true, constraints: ["type forward, redirect or fixed-response (authentication types out of scope)", "forward: 1 to 5 target groups, weight 0 to 999", "redirect: status HTTP_301 or HTTP_302", "fixed-response: content_type required, status 2XX, 4XX or 5XX"], src: [S2], status: verified }
  target_group:
    - { key: name, type: string, force_new: true, constraints: ["up to 32 characters, alphanumeric or hyphens, no leading or trailing hyphen", "unique per Region and account"], src: [S3], status: verified }
    - { key: target_type, type: enum, values: [instance, ip, lambda], default: instance, force_new: true, constraints: ["cannot be changed after creation", "alb target type is not valid under an ALB"], src: [S3, S7], status: verified }
    - { key: port, type: number, force_new: true, constraints: ["required for instance and ip", "not used for lambda"], src: [S3], status: verified }
    - { key: protocol, type: enum, values: [HTTP, HTTPS], force_new: true, constraints: ["required for instance and ip", "not used for lambda"], src: [S3, S7], status: verified }
    - { key: vpc_id, type: reference, ref: vpc, force_new: true, constraints: ["required for instance and ip", "not used for lambda"], src: [S3], status: verified }
    - { key: health_check, type: object, fields: { enabled: { default: true }, protocol: { values: [HTTP, HTTPS], default: HTTP, note: "not allowed for lambda" }, path: { default: "/", note: "required for HTTP and HTTPS" }, matcher: { default: "200", range: "200 to 499" }, interval: { default: 30, range: [5, 300], note: "for lambda must exceed the function timeout" }, timeout: { default: "HTTP 6, HTTPS 10, lambda 30", range: [2, 120] }, healthy_threshold: { default: 3, range: [2, 10] }, unhealthy_threshold: { default: 3, range: [2, 10] }, port: { default: "traffic-port" } }, constraints: ["health checks send real requests to the backends"], src: [S3], status: verified }
    - { key: deregistration_delay, type: number, default: 300, range: [0, 3600], src: [S3, S7], status: verified }
    - { key: slow_start, type: number, default: 0, range: [30, 900], src: [S3, S7], status: verified }
    - { key: load_balancing_algorithm_type, type: enum, values: [round_robin, least_outstanding_requests, weighted_random], default: round_robin, src: [S3, S7], status: verified }
    - { key: stickiness, type: object, fields: { type: [lb_cookie, app_cookie], cookie_duration: { default: 86400, range: [1, 604800] } }, constraints: ["app cookie names must not start with AWSALB, AWSALBAPP or AWSALBTG"], src: [S3, S7], status: verified }
  target_attachment:
    - { key: target_group_arn, type: reference, ref: alb-target-group, required: true, src: [S4], status: verified }
    - { key: target_id, type: string, required: true, constraints: ["instance: the instance ID", "ip: an IP address", "lambda: the function ARN, with an aws_lambda_permission for elasticloadbalancing.amazonaws.com and depends_on it", "ECS services register their tasks themselves through the service's load_balancer block"], src: [S4], status: verified }
    - { key: port, type: number, src: [S4], status: verified }
limits:
  - { id: albs_per_region, value: 50, adjustable: true, src: [S6], status: verified }
  - { id: listeners_per_alb, value: 50, adjustable: true, src: [S6], status: verified }
  - { id: rules_per_alb, value: 100, adjustable: true, src: [S6], status: verified, note: "excluding default rules" }
  - { id: certificates_per_alb, value: 25, adjustable: true, src: [S6], status: verified, note: "excluding default certificates" }
  - { id: target_groups_per_alb, value: 100, adjustable: false, src: [S6], status: verified }
  - { id: target_groups_per_action, value: 5, adjustable: false, src: [S6], status: verified }
  - { id: targets_per_alb, value: 1000, adjustable: true, src: [S6], status: verified }
  - { id: target_groups_per_region, value: 3000, adjustable: true, src: [S6], status: verified, note: "shared with network load balancers" }
  - { id: targets_per_target_group, value: "1,000 instances or IPs; 1 Lambda function", adjustable: "instances and IPs only", src: [S6], status: verified }
  - { id: load_balancers_per_target_group, value: 1, adjustable: false, src: [S6, S7], status: verified }
  - { id: request_header_size, value: "64 K total, 16 K per header", adjustable: false, src: [S6], status: verified }
relations: [containment, sg-attach, network-access, listener-target, cert-attach, dns-alias, origin, resource-policy]
cost: { model: mixed, notes: "hourly plus load balancer capacity units; unverified. A public IPv4 address per enabled zone of an internet-facing ALB (unverified)" }
status: verified
---

# Application Load Balancer

## Purpose

The single entry point for HTTP and HTTPS traffic. It spreads requests over targets (EC2 instances, ECS tasks,
Lambda functions) and checks their health. Use it for web applications and APIs behind a stable name. For raw
TCP or UDP, use a Network Load Balancer, which is out of scope here.

Three kinds of resource make one ALB: the **load balancer** (nodes in subnets), **listeners** (a protocol and port
that accept connections and decide what to do with them) and **target groups** (the pools of targets with a health
check).

## Behaviour

- **Subnets and zones.** At least two subnets, each in a different AZ; each enabled zone gets a load balancer
  node. A zone you enable but have no targets in is wasted; targets in a zone you did not enable get no traffic
  (S5).
- **Subnet size.** Each subnet should be at least `/27` with at least 8 free addresses so the load balancer can
  scale; without them it can fail to replace nodes, run with too little capacity and return 5xx errors (S5). ELB
  also keeps reserved network interfaces in the subnets (S5).
- **Security groups.** The load balancer's group must allow traffic in both directions on the listener ports and on
  the health check ports; adding a listener or changing the health check port means re-checking the rules (S5).
  Targets' groups must in turn allow the load balancer's group on the target and health check ports
  ([network-access](../relations/network-access.md)).
- **Names.** The default DNS name is `<name>-<id>.elb.<region>.amazonaws.com`, resolving to one address per
  enabled zone. Use a Route 53 alias record for a friendly name (S5, [dns-alias](../relations/dns-alias.md)).
- **Cross-zone.** Always on at the load balancer level and cannot be changed; a target group can turn it off (S1,
  S5, S7).
- **Listeners.** Protocols HTTP and HTTPS. An HTTPS listener needs exactly one default certificate and a security
  policy; more certificates are added with `aws_lb_listener_certificate` (S2, S8). The default `ssl_policy` in the
  provider is `ELBSecurityPolicy-2016-08`, which is old (S2). The default action must be `forward`, `redirect` or
  `fixed-response` here (S2).
- **Target groups.** A target group has one target type, fixed at creation: `instance` (by instance ID, traffic
  goes to the primary private address), `ip` (any private address in the VPC or RFC 1918 or RFC 6598 ranges, never
  public addresses), or `lambda` (one function) (S7). Instance IDs and IP addresses cannot be mixed. A target group
  works with one load balancer only (S6, S7). The target group's protocol and port are what the load balancer uses
  to reach targets; a registration can override the port (S7).
- **Health checks** run per target group on every target in an enabled zone; a request is sent to the check path
  and a target is healthy when the response code matches (S3, S7). New targets start receiving traffic as soon as
  they pass the first check (S7).
- **Deregistration.** A deregistered target drains for `deregistration_delay` (default 300 seconds) before it is
  removed (S7).
- **Lambda targets.** One function per target group, no port, protocol or VPC; the function must allow
  `elasticloadbalancing.amazonaws.com` to invoke it, and the attachment must depend on that permission (S4). Local
  Zone and Outpost subnets do not support Lambda targets (S5).
- **HTTPS to targets.** If the target group protocol is HTTPS the load balancer does not validate the targets'
  certificates, so self-signed ones work (S7).
- **Access logs** are off by default, even when a bucket is named (S1); the bucket rules are in
  [resource-policy](../relations/resource-policy.md).
- **Deletion protection** blocks deleting through the API, so Terraform cannot destroy it until it is turned off
  (S1).
- **Timeouts.** Create, update and delete take up to 10 minutes each (S1).

## Placement

An internet-facing ALB needs public subnets (route to an internet gateway), an internal one private subnets. At
least two AZs in either case. The security group is explicit (D-005). Rule [VAL-074](../rules/validation.md) flags
an internet-facing ALB in private subnets (`unverified`).

## Relations

- [containment](../relations/containment.md): subnets and VPC.
- [sg-attach](../relations/sg-attach.md): `security_groups`; at least one explicit group.
- [network-access](../relations/network-access.md): the ALB as caller to EC2 and ECS targets.
- [listener-target](../relations/listener-target.md): listeners forward to target groups, which hold targets.
- [cert-attach](../relations/cert-attach.md): the HTTPS certificate.
- [dns-alias](../relations/dns-alias.md): a friendly name through Route 53.
- [origin](../relations/origin.md): an ALB can be a CloudFront origin.
- [resource-policy](../relations/resource-policy.md): the log bucket policy and the Lambda invoke permission.

## Failure modes

| Situation | Result |
|---|---|
| Fewer than two subnets, or two in one AZ | Rejected. Rule [VAL-071](../rules/validation.md) |
| Subnet smaller than `/27` or short of free addresses | The load balancer cannot scale; 5xx or timeouts (S5). Rule [VAL-072](../rules/validation.md) |
| Security group blocks the listener or health check port | Clients cannot connect, or all targets look unhealthy and the load balancer returns 503 (S5). Rule [VAL-082](../rules/validation.md) |
| HTTPS listener without certificate or policy | Rejected (S2). Rule [VAL-075](../rules/validation.md) |
| Target group used by two load balancers | Rejected (S6). Rule [VAL-078](../rules/validation.md) |
| Targets of the wrong type registered | Rejected; the type is fixed (S7). Rule [VAL-079](../rules/validation.md) |
| `ip` target outside the allowed ranges, or a public IP | Rejected (S7). Rule [VAL-080](../rules/validation.md) |
| Lambda target without invoke permission | Registration or invocation fails (S4). Rule [VAL-081](../rules/validation.md) |
| Health check interval not above the Lambda timeout | Rejected (S3). Rule [VAL-083](../rules/validation.md) |
| Changing a target group's name, port, protocol, VPC or type | Replaced (S3). Pitfall P-046 |
| Changing a listener's load balancer | Replaced (S2). Pitfall P-045 |
| Replacing a certificate that a listener uses | Needs `create_before_destroy` on the certificate (S2 of [acm](acm.md)). Pitfall P-048 |
| Deleting with deletion protection on | Blocked (S1) |

## Limits, cost, security

See front matter. Security: serve HTTPS and redirect HTTP ([SEC-024](../rules/security.md)), use a current TLS
policy ([SEC-025](../rules/security.md)), drop invalid headers ([SEC-026](../rules/security.md)), turn on access
logs ([SEC-028](../rules/security.md)).

## Terraform mapping

`aws_lb` (`name`, `load_balancer_type = "application"`, `internal`, `subnets`, `security_groups`, `idle_timeout`,
`drop_invalid_header_fields`, `enable_deletion_protection`, `access_logs`, `tags`), `aws_lb_target_group`
(`name`, `target_type`, `port`, `protocol`, `vpc_id`, `health_check`), `aws_lb_listener` (`load_balancer_arn`,
`port`, `protocol`, `ssl_policy`, `certificate_arn`, `default_action`) and, for EC2, IP or Lambda targets,
`aws_lb_target_group_attachment`. ECS services register themselves through their own `load_balancer` block (see
[ecs](ecs.md)) and need `depends_on` the listener so the target group is attached to a load balancer first
(`unverified`: the ECS service page does not state it). `aws_alb`, `aws_alb_listener` and `aws_alb_target_group` are
aliases of the same resources (S2, S3).

## Sources

S1 to S9 in the front matter.

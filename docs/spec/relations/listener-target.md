---
id: listener-target
title: { vi: "Listener chuyển tiếp tới target", en: "Listener to target" }
participants:
  - { role: balancer, service: alb }
  - { role: target, service: [ec2, ecs, lambda] }
direction: alb->target
same_vpc: true               # instance and ip targets; a Lambda target has no VPC
cardinality: { balancer: many, target: many }     # a target group serves exactly one ALB; a target may be in several target groups
user_drawn: true
generates:
  - { terraform: "aws_lb_target_group (target_type instance | ip | lambda)", on: alb }
  - { terraform: "aws_lb_listener.default_action forward to the target group", on: alb }
  - { terraform: "aws_lb_target_group_attachment", on: "ec2 (instance id), lambda (function ARN)" }
  - { terraform: "aws_ecs_service.load_balancer { target_group_arn, container_name, container_port }", on: ecs }
  - { terraform: "aws_lambda_permission for elasticloadbalancing.amazonaws.com", on: lambda }
  - { rule: "ingress on the target group's security group from the ALB's group, on the target port and the health check port", via: network-access }
conditions:
  - { text: { vi: "Target group dùng cho đúng một ALB", en: "A target group is used by exactly one ALB" }, when: always }
  - { text: { vi: "Task Fargate dùng target group kiểu ip", en: "Fargate tasks use an ip target group" }, when: "target is ecs" }
  - { text: { vi: "Lambda cần quyền cho elasticloadbalancing.amazonaws.com gọi hàm", en: "Lambda needs permission for elasticloadbalancing.amazonaws.com to invoke it" }, when: "target is lambda" }
invalid_when: [VAL-043, VAL-071, VAL-076, VAL-077, VAL-078, VAL-079, VAL-080, VAL-081, VAL-082, VAL-083]
sources:
  S1: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/lb_target_group.html.markdown
  S3: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/lb_target_group_attachment.html.markdown
  S4: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/lb_listener.html.markdown
  S5: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
  S6: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html
  S7: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/ecs_service.html.markdown
status: verified          # items marked unverified in the cases
---

# Listener to target

## Meaning

A listener accepts connections on a protocol and port and, by its default action, **forwards** them to a target
group. The target group is a pool of targets with a health check. Drawing "ALB to X" means: add a target group for
X, forward the listener to it, register X in it, and allow the traffic through security groups.

```
client --> listener (HTTPS :443) --default action--> target group (health check) --> EC2 | ECS tasks | Lambda
```

## Cases

| # | Target | Target group type | How targets are registered | Notes |
|---|---|---|---|---|
| 1 | EC2 instance | `instance` | `aws_lb_target_group_attachment` with the instance ID | Traffic goes to the instance's primary private address (S1, S3) |
| 2 | ECS Fargate service | `ip` | The service registers its own tasks through its `load_balancer` block | `container_name` and `container_port` required; target type must be `ip` (S6, S7) |
| 3 | Lambda function | `lambda` | `aws_lb_target_group_attachment` with the function ARN, `depends_on` an `aws_lambda_permission` | No port, protocol or VPC on the group; one function per group; not valid in Local Zone subnets (S1, S2, S3, S5) |
| 4 | Several target groups in one forward action | any | | 1 to 5 groups, weights 0 to 999 (S4). One group serves one ALB (S1) |
| 5 | One target group used by two ALBs | | | Invalid (S1). Rule [VAL-078](../rules/validation.md) |
| 6 | Instances and IPs mixed in one group | | | Invalid; the type is fixed at creation (S1, S2). Rule [VAL-079](../rules/validation.md) |
| 7 | `ip` target with a public address, or outside the VPC subnets and the RFC 1918 / RFC 6598 ranges | | | Invalid (S1, S2). Rule [VAL-080](../rules/validation.md) |
| 8 | Target in a zone the ALB does not use | | | Registered but gets no traffic (S5). Rule [VAL-071](../rules/validation.md) concerns the zones |
| 9 | Internet-facing ALB, targets in private subnets | | | Works: the ALB nodes reach targets by private address inside the VPC (the VPC's local route, [route](route.md)) |
| 10 | Health check on a port other than the traffic port | | | Both ports must be open between ALB and target (S5). Rule [VAL-082](../rules/validation.md) |
| 11 | Health check path or matcher the application does not satisfy | | | All targets unhealthy, 503 to clients. Health checks send real requests (S2) |
| 12 | Lambda health check | | | `interval` must exceed the function timeout; no protocol (S2). Rule [VAL-083](../rules/validation.md) |
| 13 | Target group protocol HTTPS | | | The ALB does not validate the target's certificate (S1) |
| 14 | Listener default action `redirect` (for example HTTP 80 to HTTPS 443) | none | no target group | Status `HTTP_301` or `HTTP_302` (S4). Use on the HTTP listener. [SEC-024](../rules/security.md) |
| 15 | Listener default action `fixed-response` | none | no target group | Status 2XX, 4XX or 5XX (S4) |
| 16 | Port in the target group differs from the container or server port | | | Traffic goes to a port nothing listens on; the platform takes the port from the target |
| 17 | ECS service created before its target group has a load balancer | | | Can fail; use `depends_on` the listener (`unverified`, the ECS page does not state it) |
| 18 | Target deregistered or replaced | | | Drains for `deregistration_delay` (default 300 s) before removal (S1) |
| 19 | New target added | | | Receives traffic once registered and past the first health check, regardless of the threshold; `slow_start` ramps it (S1) |
| 20 | Target group attached to an ALB listener rule only (not the default action) | | | Rules are out of scope (D-019) |

## Failure modes

The common ones are in the cases: wrong target type, a public IP, a group shared by two ALBs, blocked health check
ports, a Lambda without permission. Unhealthy targets are the usual silent failure, so the health check path and
port deserve the same care as the listener.

## Terraform mapping

```hcl
resource "aws_lb_target_group" "app" {
  name        = "app"
  target_type = "ip"            # ECS Fargate
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  health_check { path = "/health" matcher = "200" }
}
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.web.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.web.certificate_arn
  default_action { type = "forward" target_group_arn = aws_lb_target_group.app.arn }
}
```

Illustrative; arguments are in [alb](../services/alb.md). For ECS, the service carries
`load_balancer { target_group_arn = aws_lb_target_group.app.arn  container_name = "app"  container_port = 8080 }` and
`depends_on = [aws_lb_listener.https]` (the `depends_on` is `unverified`).

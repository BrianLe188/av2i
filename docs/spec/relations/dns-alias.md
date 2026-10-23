---
id: dns-alias
title: { vi: "Bản ghi alias DNS", en: "DNS alias record" }
participants:
  - { role: record, service: route53 }
  - { role: target, service: [alb, cloudfront] }
direction: record->target
same_vpc: false
cardinality: { record: many, target: many }      # several names may point at one target; one name at one target (simple routing)
user_drawn: true
generates:
  - { terraform: "aws_route53_record type A with alias { name, zone_id, evaluate_target_health }", on: "alb, cloudfront" }
  - { terraform: "aws_route53_record type AAAA with alias", on: "cloudfront when is_ipv6_enabled" }
conditions:
  - { text: { vi: "Hosted zone phải là public khi trỏ tới CloudFront", en: "The hosted zone must be public when pointing to CloudFront" }, when: "target is cloudfront" }
  - { text: { vi: "CloudFront phải có domain này trong aliases cùng chứng chỉ phủ tên đó", en: "The distribution must list this name in aliases with a certificate that covers it" }, when: "target is cloudfront" }
invalid_when: [VAL-085, VAL-086, VAL-087, VAL-088, VAL-089, VAL-090]
sources:
  S1: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html
  S2: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html
  S3: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-elb-load-balancer.html
  S4: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/route53_record.html.markdown
  S5: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
status: verified          # the CloudFront hosted zone ID constant and the ALB zone ID attribute name are unverified
---

# DNS alias record

## Meaning

A Route 53 alias record gives a friendly name (`www.example.com`, `example.com`) to an ALB or a CloudFront
distribution. Route 53 answers with the target's current addresses, so no address is stored and a change of the
target needs no DNS edit (S1). ALBs have a generated name like `my-lb-123.elb.us-east-2.amazonaws.com`; the alias
replaces it (S5).

## Cases

| # | Situation | Result |
|---|---|---|
| 1 | Alias A record to an ALB, same account | Resolves to the load balancer. Use the load balancer's DNS name and its **own hosted zone ID** (a per-Region value exposed by the load balancer) (S3, S4) |
| 2 | Alias A record to a CloudFront distribution | The target name is the distribution's `*.cloudfront.net` name, and the hosted zone ID is CloudFront's fixed global zone (`Z2FDTNDATAQYW2`, `unverified`: not shown on the page read) (S2) |
| 3 | Distribution has IPv6 on | A second alias record of type AAAA is needed (S2). Rule [VAL-089](../rules/validation.md) |
| 4 | Name is the zone apex (`example.com`) | An alias is allowed there; a CNAME is not (S1). Rule [VAL-087](../rules/validation.md) |
| 5 | Alias to a record in the same zone | Allowed, must be the same type, and not a CNAME at the apex (S1) |
| 6 | CNAME instead of alias to an ALB or CloudFront | Possible for subdomains but charged per query and not possible at the apex (S1). The platform generates aliases |
| 7 | `evaluate_target_health` | Required in Terraform (S4). For an ALB, Route 53 evaluates the target groups' health: the record is healthy only if every attached target group passes (a group passes with at least one healthy target, or its configured threshold), and it fails if any group is unhealthy or all groups are empty (S3 of [alb](../services/alb.md), the target group page); for CloudFront the console default is No (S2) |
| 8 | `ttl` or `records` given with `alias` | Invalid (S4). Rule [VAL-085](../rules/validation.md) |
| 9 | TTL | Fixed at 60 seconds; not settable (S1, S4) |
| 10 | Hosted zone is private | CloudFront aliases are valid only in public hosted zones (S2). Private zones are out of scope |
| 11 | The distribution's `aliases` lacks this name, or its certificate does not cover it | The name resolves but the distribution does not serve it or TLS fails (S2). Rule [VAL-088](../rules/validation.md) |
| 12 | The ALB's HTTPS listener certificate does not cover this name | Clients see a certificate name error. Rule [VAL-102](../rules/validation.md) |
| 13 | Two records with the same name and type | One must go; simple routing allows one (S4) |
| 14 | Several names to one target | Several records, each its own alias |
| 15 | Target replaced (new ALB name) | The alias follows when it references the target's attributes; a hard-coded name does not |
| 16 | Domain not delegated to the zone's name servers | Nothing resolves (S2, S3) |
| 17 | Weighted, latency, failover, geolocation routing | Out of scope (D-020); records need a `set_identifier` then (S4) |
| 18 | Alias in a subdomain zone | The parent zone needs an NS record for the subdomain ([route53](../services/route53.md)) |

## Failure modes

Resolution works but the service does not: certificate not covering the name, CloudFront without the alternate
domain name, ALB security group closed, or no healthy target. Resolution does not work: wrong zone, wrong
delegation, or a record that conflicts with an existing one.

## Terraform mapping

```hcl
resource "aws_route53_record" "www" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "www.example.com"
  type    = "A"
  alias {
    name                   = aws_lb.web.dns_name
    zone_id                = aws_lb.web.zone_id
    evaluate_target_health = true
  }
}
```

For CloudFront the alias uses `aws_cloudfront_distribution.<x>.domain_name` and `.hosted_zone_id` (attribute names
`unverified`: the distribution page read did not list its exported attributes). Add the `AAAA` record when IPv6 is
on.

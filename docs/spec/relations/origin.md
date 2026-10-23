---
id: origin
title: { vi: "Origin của CloudFront", en: "CloudFront origin" }
participants:
  - { role: distribution, service: cloudfront }
  - { role: origin, service: [s3, alb] }
direction: cloudfront->origin
same_vpc: false
cardinality: { distribution: many, origin: many }   # up to 100 origins per distribution; one bucket or ALB may serve several distributions
user_drawn: true
generates:
  - { terraform: "aws_cloudfront_distribution.origin (domain_name, origin_id, origin_access_control_id)", on: "s3" }
  - { terraform: "aws_cloudfront_distribution.origin with custom_origin_config", on: "alb" }
  - { terraform: "aws_cloudfront_origin_access_control (origin type s3, signing always, sigv4)", on: "s3" }
  - { terraform: "bucket policy statement allowing cloudfront.amazonaws.com with aws:SourceArn = distribution ARN", on: "s3", via: resource-policy }
conditions:
  - { text: { vi: "S3 phải là endpoint thường, không phải website endpoint, khi dùng OAC", en: "The S3 origin must be the regular endpoint, not a website endpoint, when using OAC" }, when: "origin is s3" }
  - { text: { vi: "ALB phải hướng Internet; chứng chỉ ở ALB phải khớp domain của origin nếu dùng HTTPS", en: "The ALB must be internet-facing; with HTTPS its certificate must match the origin domain" }, when: "origin is alb" }
invalid_when: [VAL-054, VAL-091, VAL-096, VAL-097, VAL-098]
sources:
  S1: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/cloudfront_distribution.html.markdown
  S3: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/cloudfront_origin_access_control.html.markdown
  S4: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html
  S5: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html
status: verified          # items marked unverified in the cases
---

# CloudFront origin

## Meaning

An origin is where CloudFront fetches content on a cache miss. Each cache behaviour points at one origin. Two kinds
are specified: an S3 bucket, kept private and read only by the distribution, and an ALB, reached over HTTP or
HTTPS like any web server.

## S3 origin with origin access control

OAC makes CloudFront sign its requests to S3, and the bucket policy allows only that distribution to read. It is
recommended over the older origin access identity because it supports all Regions, SSE-KMS and dynamic requests
(PUT, DELETE) (S1).

| # | Situation | Result |
|---|---|---|
| 1 | Regular S3 endpoint, OAC `always`, bucket policy allowing `cloudfront.amazonaws.com` with `AWS:SourceArn` = the distribution ARN | The standard private static site (S1) |
| 2 | Bucket is a **website endpoint** | Must be a custom origin; OAC cannot be used (S1). Rule [VAL-091](../rules/validation.md) |
| 3 | Object Ownership `ObjectWriter` | OAC needs `BucketOwnerEnforced`, or `BucketOwnerPreferred` when ACLs are needed (S1). Rule [VAL-054](../rules/validation.md) |
| 4 | Objects encrypted with SSE-KMS | The KMS key policy must also allow the distribution; KMS is Tier 2 (S1) |
| 5 | OAC `signing_behavior` `never` on a private bucket | CloudFront cannot read it. Rule [VAL-096](../rules/validation.md) |
| 6 | OAC `signing_behavior` `no-override` | Signs only when the viewer sent no `Authorization` header; advanced (S1) |
| 7 | Read-only vs read-write access | The policy statement carries `s3:GetObject`, plus `s3:PutObject` if viewers upload (S1) |
| 8 | Several distributions read one bucket | One statement per distribution; an OAC may serve up to 100 distributions (S1, S5) |
| 9 | Origin access identity (legacy) | Not generated; migrate to OAC (S1) |
| 10 | Deleting the distribution and the bucket | Delete the distribution first; or include the Region in the origin domain name (S1) |
| 11 | Origin `domain_name` | Use the bucket's regional domain name (an exported attribute); the global name can redirect before the bucket's Region is known (`unverified` for the behaviour; the Region hint is in S1) |
| 12 | Origin path | `origin_path` prefixes every request (S2) |

## ALB (custom) origin

| # | Situation | Result |
|---|---|---|
| 13 | Internet-facing ALB, `origin_protocol_policy` `https-only`, certificate on the ALB matching the origin domain | Works. With no matching name CloudFront returns 502 (S4). Rule [VAL-098](../rules/validation.md) |
| 14 | The ALB's certificate can be in any Region | True when the ALB is a CloudFront origin (S4); the **viewer** certificate must still be in `us-east-1` |
| 15 | Internal (private) ALB | Not reachable; CloudFront reaches origins over the internet. VPC origins are out of scope (D-021) |
| 16 | `origin_protocol_policy` `http-only` | Plain HTTP between CloudFront and the origin; avoid. [SEC-029](../rules/security.md) covers the viewer side |
| 17 | `match-viewer` | Uses the viewer's protocol (S2) |
| 18 | Origin read timeout | Default 30 s, 60 s upper limit unless raised; keep-alive default 5 s (S2, S5). Rule [VAL-097](../rules/validation.md) |
| 19 | Restricting the ALB so only CloudFront can call it | Common practice is a secret `custom_header` checked by the ALB, or the CloudFront origin-facing managed prefix list in the ALB's security group. Both are `unverified` here; custom headers exist on origins (S2, at most 30) |
| 20 | Several behaviours using different origins | Allowed, up to 100 origins and 75 behaviours (S5) |
| 21 | Caching a dynamic ALB origin | Needs a cache policy suited to it; managed policies are referenced by ID or data source (`unverified`) |

## Failure modes

AccessDenied from S3 means the bucket policy or ownership is wrong. 502 from CloudFront means the origin's
certificate does not match, the origin is unreachable or it timed out. A deployment can take about 15 minutes
before a change is visible (S2).

## Terraform mapping

```hcl
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
# in aws_cloudfront_distribution:
origin {
  origin_id                = "site"
  domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
  origin_access_control_id = aws_cloudfront_origin_access_control.site.id
}
```

For an ALB: `origin { origin_id = "api"  domain_name = aws_lb.api.dns_name  custom_origin_config {
http_port = 80  https_port = 443  origin_protocol_policy = "https-only"  origin_ssl_protocols = ["TLSv1.2"] } }`.
Use either `origin_access_control_id` or `s3_origin_config`, not both, for the same bucket (S2). The bucket policy
is a separate, merged resource ([resource-policy](resource-policy.md)).

---
id: cloudfront
title: { vi: "CloudFront (CDN)", en: "Amazon CloudFront distribution" }
terraform:
  resources: [aws_cloudfront_distribution, aws_cloudfront_origin_access_control]
scope: global
placement: { requires: [], subnet_type: null, min_azs: null }
sources:
  S1: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/cloudfront_distribution.html.markdown
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/cloudfront_origin_access_control.html.markdown
  S3: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
  S4: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html
  S5: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html
  S6: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html
scope_note: "A standard web distribution with S3 (through OAC) and ALB (custom origin) origins, managed cache policies, one default behaviour plus ordered behaviours. Lambda@Edge, CloudFront Functions, signed URLs and cookies, field-level encryption, origin groups, VPC origins, multi-tenant distributions, mTLS, continuous deployment, real-time logs, the legacy logging config, OAI and the deprecated forwarded_values are out of scope (decision D-021)"
properties:
  - key: enabled
    type: boolean
    required: true
    src: [S1]
    status: verified
  - key: comment
    type: string
    src: [S1]
    status: verified
  - key: aliases
    type: list
    constraints:
      - "alternate domain names (CNAMEs), at most 100 per distribution"
      - "each must be covered by the attached certificate: an exact SAN match or a wildcard at the same level"
    src: [S1, S4, S5]
    status: verified
  - key: default_root_object
    type: string
    src: [S1]
    status: verified
  - key: price_class
    type: enum
    values: [PriceClass_All, PriceClass_200, PriceClass_100]
    constraints: ["limits the edge locations used and so the cost"]
    src: [S1]
    status: verified
  - key: http_version
    type: enum
    values: [http1.1, http2, http2and3, http3]
    default: http2
    constraints: ["every distribution sharing one certificate must use the same value"]
    src: [S1, S4]
    status: verified
  - key: is_ipv6_enabled
    type: boolean
    constraints: ["when true, each alias needs both an A and an AAAA Route 53 record"]
    src: [S1, S6]
    status: verified
  - key: web_acl_id
    type: string
    constraints: ["a WAFv2 web ACL in the Global (CloudFront) scope; WAF itself is a Tier 2 service"]
    src: [S1]
    status: verified
  - key: wait_for_deployment
    type: boolean
    default: true
    src: [S1]
    status: verified
  - key: retain_on_delete
    type: boolean
    default: false
    constraints: ["true disables instead of deleting on destroy, leaving it to delete by hand"]
    src: [S1]
    status: verified
  - key: origins
    type: list
    required: true
    item:
      origin_id: { required: true, constraints: ["unique within the distribution"] }
      domain_name: { required: true }
      origin_access_control_id: { constraints: ["S3 origin: use this, not s3_origin_config with an OAI"] }
      origin_path: {}
      custom_header: { constraints: ["at most 30 added headers per distribution"] }
      connection_attempts: { default: 3, range: [1, 3] }
      connection_timeout: { default: 10, range: [1, 10], unit: seconds }
      custom_origin_config: { required_for: "non-S3 origins, such as an ALB", fields: { http_port: required, https_port: required, origin_protocol_policy: { values: [http-only, https-only, match-viewer], required: true }, origin_ssl_protocols: { values: [SSLv3, TLSv1, TLSv1.1, TLSv1.2], required: true }, origin_read_timeout: { default: 30, note: "upper limit 60 unless raised" }, origin_keepalive_timeout: { default: 5, note: "upper limit 60 unless raised" } } }
    constraints: ["an S3 bucket configured as a website endpoint must be a custom origin and cannot use OAC", "at most 100 origins"]
    src: [S1, S3, S5]
    status: verified
  - key: default_cache_behavior
    type: object
    required: true
    fields:
      # the platform builds target_origin_id from the origin connections, allowed and cached methods from `methods`, and
      # cache and origin request policies by data source on the managed policy name (D-021)
      viewer_protocol_policy: { values: [allow-all, https-only, redirect-to-https], default: redirect-to-https, required: true }
      methods: { values: [read-only, all], default: read-only, note: "read-only is GET and HEAD, all adds OPTIONS, PUT, POST, PATCH and DELETE" }
      cache_policy: { default: Managed-CachingOptimized, note: "a managed cache policy by name; Managed-CachingDisabled suits a dynamic origin" }
      origin_request_policy: { note: "a managed origin request policy by name, for example Managed-AllViewer" }
      compress: { default: true, provider_default: false }
    constraints: ["no path_pattern on the default behaviour", "forwarded_values is deprecated in favour of cache_policy_id"]
    src: [S1]
    status: verified
  - key: ordered_cache_behavior
    type: list
    constraints: ["path_pattern required", "at most 75 cache behaviours per distribution in total"]
    src: [S1, S5]
    status: verified
  - key: restrictions
    type: object
    fields: { restriction_type: { values: [none, whitelist, blacklist], default: none }, locations: { note: "ISO 3166-1 alpha-2 codes, a list; empty when none" } }
    constraints: ["written as restrictions.geo_restriction in the provider"]
    src: [S1]
    status: verified
  - key: viewer_certificate
    type: object
    required: true
    fields:
      # acm_certificate_arn comes from the connected certificate (cert-attach)
      cloudfront_default_certificate: { default: false, note: "true uses the *.cloudfront.net certificate; not allowed with aliases (VAL-094)" }
      ssl_support_method: { values: [sni-only, vip, static-ip], default: sni-only, note: "vip may cost extra" }
      minimum_protocol_version: { default: TLSv1.2_2021, provider_default: TLSv1, examples: [TLSv1.2_2019, TLSv1.2_2021] }
    constraints: ["exactly one of acm_certificate_arn, iam_certificate_id, cloudfront_default_certificate", "only one certificate per distribution", "the provider page's rules on minimum_protocol_version conflict with each other for the default certificate; check before relying on them"]
    src: [S1, S4, S5]
    status: verified
  - key: custom_error_response
    type: list
    constraints: ["response_page_path and response_code must be set together"]
    src: [S1]
    status: verified
oac:
  - { key: name, type: string, required: true, src: [S2], status: verified }
  - { key: origin_access_control_origin_type, type: enum, values: [s3, lambda, mediapackagev2, mediastore], required: true, constraints: ["the platform uses s3"], src: [S2], status: verified }
  - { key: signing_behavior, type: enum, values: [always, never, no-override], required: true, constraints: ["always is the recommended and common choice; with always CloudFront-to-S3 traffic is always HTTPS (S3)"], src: [S2, S3], status: verified }
  - { key: signing_protocol, type: enum, values: [sigv4], required: true, src: [S2], status: verified }
limits:
  - { id: distributions_per_account, value: 500, adjustable: true, src: [S5], status: verified }
  - { id: aliases_per_distribution, value: 100, adjustable: true, src: [S5], status: verified }
  - { id: origins_per_distribution, value: 100, adjustable: true, src: [S5], status: verified }
  - { id: cache_behaviors_per_distribution, value: 75, adjustable: true, src: [S5], status: verified }
  - { id: origin_access_controls_per_account, value: 100, adjustable: true, src: [S5], status: verified }
  - { id: distributions_per_oac, value: 100, adjustable: true, src: [S5], status: verified }
  - { id: certificates_per_distribution, value: 1, adjustable: false, src: [S5], status: verified }
  - { id: dedicated_ip_certificates_per_account, value: 2, adjustable: true, src: [S5], status: verified, note: "no limit with SNI" }
  - { id: custom_headers_per_origin_request, value: 30, adjustable: true, src: [S5], status: verified }
  - { id: custom_cache_policies_per_account, value: 20, adjustable: true, src: [S5], status: verified }
  - { id: cacheable_object_size, value: "50 GB per GET response", adjustable: false, src: [S5], status: verified }
  - { id: request_url_length, value: "8,192 bytes", adjustable: false, src: [S5], status: verified }
  - { id: invalidations, value: "150 paths per second, 1 wildcard invalidation per second", adjustable: false, src: [S5], status: verified }
  - { id: origin_response_timeout, value: "1 to 120 seconds", adjustable: true, src: [S5], status: verified }
relations: [origin, cert-attach, dns-alias, resource-policy]
cost: { model: usage, notes: "data transfer out and requests by price class; unverified. Dedicated-IP custom SSL costs extra (S1)" }
status: verified
---

# CloudFront distribution

## Purpose

A content delivery network: viewers are served from edge locations near them, and CloudFront fetches from your
**origin** only on a cache miss. Use it to speed up and protect a static site (S3) or a dynamic application (an
ALB), to terminate HTTPS at the edge, and to keep a bucket private. It is global: one distribution, no Region, no
VPC.

## Behaviour

- **Origins.** An S3 bucket (regular endpoint) with origin access control, or a custom origin (an ALB or any HTTP
  server). A bucket configured as a **website endpoint** must be a custom origin and cannot use OAC (S3). An origin
  has connection attempts (1 to 3) and timeouts (S1, S5). See [origin](../relations/origin.md).
- **Cache behaviours.** One default behaviour plus ordered ones matched by path pattern; each picks an origin, a
  viewer protocol policy, allowed and cached methods and, preferably, a cache policy (S1). `forwarded_values` is
  deprecated (S1). CloudFront supplies managed cache policies; whether the platform references them by ID or through
  a data source is not settled here (`unverified`).
- **HTTPS to viewers.** `viewer_protocol_policy` is `allow-all`, `https-only` or `redirect-to-https` (S1). The
  default `minimum_protocol_version` is `TLSv1`, which is old (S1).
- **Own domain.** `aliases` lists alternate domain names. Each must be covered by the attached certificate (an exact
  match in the SAN field or a wildcard at the same level), the certificate must be **in `us-east-1`**, and a
  distribution has only one certificate (S1, S4, S5). The default `*.cloudfront.net` certificate cannot serve your
  own names (S1, S4). See [cert-attach](../relations/cert-attach.md) and [dns-alias](../relations/dns-alias.md).
- **HTTPS to a custom origin.** If `origin_protocol_policy` uses HTTPS, one name in the origin's certificate must
  match the origin domain name or CloudFront returns 502 (S4). For an ALB origin the certificate can be in any
  Region (S4).
- **Deployment.** A create or change takes about 15 minutes to reach `Deployed`, and related deletes are blocked
  meanwhile. `wait_for_deployment` is true by default; `retain_on_delete` leaves a disabled distribution to delete by
  hand (S1).
- **IPv6.** With `is_ipv6_enabled`, each alias needs both an A and an AAAA alias record (S6).
- **Sharing a certificate.** Distributions that share a certificate must use the same supported HTTP versions (S4).
- **Not in a VPC.** CloudFront reaches an origin over the internet; a private (internal) ALB cannot be an origin
  without VPC origins, which are out of scope.

## Placement

Global. No subnets, no security groups. The only network concern is that the origin is reachable from the internet
(an internet-facing ALB, or the S3 regional endpoint).

## Relations

- [origin](../relations/origin.md): S3 through OAC, or an ALB as custom origin.
- [cert-attach](../relations/cert-attach.md): the viewer certificate from ACM.
- [dns-alias](../relations/dns-alias.md): the friendly name through Route 53.
- [resource-policy](../relations/resource-policy.md): the S3 bucket policy that lets this distribution read.

## Failure modes

| Situation | Result |
|---|---|
| Alias not covered by the certificate | Rejected when the alias is added (S4). Rule [VAL-093](../rules/validation.md) |
| ACM certificate not in `us-east-1` | Cannot be attached (S1, S4). Rule [VAL-093](../rules/validation.md) |
| More or fewer than one certificate source | Rejected (S1). Rule [VAL-094](../rules/validation.md) |
| S3 website endpoint used with OAC | Does not work (S3). Rule [VAL-091](../rules/validation.md) and [VAL-054](../rules/validation.md) |
| Bucket policy does not allow the distribution | `AccessDenied` for viewers ([resource-policy](../relations/resource-policy.md)) |
| Missing target origin, protocol policy or methods on a behaviour | Rejected (S1). Rule [VAL-092](../rules/validation.md) |
| Origin certificate does not match the origin domain | 502 to viewers (S4). Rule [VAL-098](../rules/validation.md) |
| Origin timeouts or attempts out of range | Rejected (S1, S5). Rule [VAL-097](../rules/validation.md) |
| Over the limits on aliases, origins, behaviours | Rejected (S5). Rule [VAL-095](../rules/validation.md) |
| `ssl_support_method` missing with an ACM certificate | Rejected (S1). Rule [VAL-094](../rules/validation.md) |
| Distribution destroyed or changed while still deploying | Blocked or slow (S1). Pitfall P-050 |
| OAC signing set to `never` on a private bucket | CloudFront cannot read it (S3). Rule [VAL-096](../rules/validation.md) |

## Limits, cost, security

See front matter. Security: redirect viewers to HTTPS ([SEC-029](../rules/security.md)), use a modern minimum TLS
version ([SEC-030](../rules/security.md)), keep S3 origins private behind OAC ([SEC-031](../rules/security.md)),
consider WAF ([SEC-032](../rules/security.md)).

## Terraform mapping

`aws_cloudfront_origin_access_control` (`name`, `origin_access_control_origin_type = "s3"`,
`signing_behavior = "always"`, `signing_protocol = "sigv4"`) and `aws_cloudfront_distribution` (`enabled`,
`aliases`, `default_root_object`, `price_class`, `is_ipv6_enabled`, `origin`, `default_cache_behavior`,
`ordered_cache_behavior`, `restrictions`, `viewer_certificate`, `custom_error_response`, `tags`). An ACM
certificate for the distribution is created with a provider configured for `us-east-1`
([acm](acm.md), decision D-022). Create the S3 bucket policy after the distribution (P-052).

## Sources

S1 to S6 in the front matter.

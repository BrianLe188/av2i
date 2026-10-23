---
id: static-site-cdn
title: { vi: "Website tĩnh: S3, CloudFront, Route 53, ACM", en: "Static site: S3, CloudFront, Route 53, ACM" }
services: [s3, cloudfront, route53, acm]
nodes:
  - { id: site, service: s3, props: { block_public_acls: true, ignore_public_acls: true, block_public_policy: true, restrict_public_buckets: true, versioning: Enabled } }
  - { id: cdn, service: cloudfront, props: { aliases: ["www.example.com", "example.com"], viewer_protocol_policy: redirect-to-https, minimum_protocol_version: TLSv1.2_2021, is_ipv6_enabled: true } }
  - { id: cert, service: acm, props: { region: us-east-1, domain_name: "example.com", subject_alternative_names: ["www.example.com"], validation_method: DNS } }
  - { id: zone, service: route53, props: { zone: public, name: "example.com" } }
connections:
  - { from: cdn, to: site, mechanism: origin, kind: drawn, note: "regular endpoint with origin access control" }
  - { from: cdn, to: site, mechanism: resource-policy, kind: generated, note: "statement for cloudfront.amazonaws.com with aws:SourceArn = the distribution" }
  - { from: cert, to: cdn, mechanism: cert-attach, kind: drawn }
  - { from: cert, to: zone, mechanism: cert-validation, kind: derived }
  - { from: zone, to: cdn, mechanism: dns-alias, kind: drawn, note: "A and AAAA for each alias name" }
expect:
  errors: []
  findings: [SEC-032, SEC-015, SEC-034]
variants:
  - { id: s3-website-endpoint, change: "origin uses the S3 website endpoint with OAC", fires: [VAL-091, VAL-054], severity: error }
  - { id: certificate-wrong-region, change: "cert created in eu-west-1", fires: [VAL-101], severity: error }
  - { id: alias-not-covered, change: "alias app.example.com not in the certificate", fires: [VAL-093, VAL-102], severity: error }
  - { id: private-zone, change: "zone is private", fires: [VAL-088], severity: error }
  - { id: missing-aaaa, change: "IPv6 enabled but only A records", fires: [VAL-089], severity: warning }
  - { id: cname-at-apex, change: "a CNAME record named example.com", fires: [VAL-087], severity: error }
  - { id: record-and-alias, change: "a record has both records and alias", fires: [VAL-085], severity: error }
  - { id: no-oac, change: "S3 origin without origin access control", fires: [SEC-031, VAL-091], severity: error }
  - { id: bucket-public, change: "block_public_policy false", fires: [SEC-012], severity: warning }
  - { id: public-policy-with-block, change: "a bucket policy statement with Principal * while block_public_policy is true", fires: [VAL-052], severity: error }
  - { id: two-bucket-policies, change: "two policy resources for one bucket", fires: [VAL-051], severity: error }
  - { id: allow-all-viewers, change: "viewer_protocol_policy allow-all", fires: [SEC-029], severity: warning }
  - { id: old-tls, change: "minimum_protocol_version TLSv1", fires: [SEC-030], severity: warning }
  - { id: oac-bad-signing, change: "signing_behavior never", fires: [VAL-096], severity: error }
  - { id: cert-and-default, change: "both acm_certificate_arn and cloudfront_default_certificate", fires: [VAL-094], severity: error }
  - { id: validation-record-deleted, change: "the validation CNAME is removed after issue", fires: [SEC-034, VAL-100], severity: info, note: "ACM can no longer renew" }
  - { id: too-many-names, change: "11 certificate names", fires: [VAL-099], severity: error }
  - { id: alias-to-s3-website, change: "route53 alias drawn to the bucket", fires: [], severity: error, note: "rejected by the matrix: route53 to s3 is invalid in this version" }
---

# Static site behind CloudFront

A private bucket served only through CloudFront. The bucket is never public; the distribution reads it with origin access
control, and the bucket policy carries one generated statement scoped to that distribution.

## What the platform derives or generates

- The **us-east-1 provider alias** is generated whenever an ACM certificate feeds CloudFront (D-022, VAL-101). The bucket and
  the rest of the design stay in the main Region.
- The bucket policy is one document built from every statement every relation wants on that bucket
  ([resource-policy](../relations/resource-policy.md), VAL-051).
- One validation CNAME per distinct validation name; the apex and the wildcard of one domain share one record
  ([cert-validation](../relations/cert-validation.md)).
- A and AAAA alias records for each alias name when `is_ipv6_enabled` is true (VAL-089).

## Edge cases this scenario exercises

| Case | Where it is decided |
|---|---|
| Certificate must be in us-east-1 for CloudFront | [cert-attach](../relations/cert-attach.md), VAL-101 |
| S3 website endpoints cannot use OAC | [origin](../relations/origin.md), VAL-054, VAL-091 |
| Apex and `www` need different aliases and both must be covered | VAL-093 |
| The distribution is not ready until it deploys; DNS points at it only after | [cloudfront](../services/cloudfront.md), pitfalls |
| Changing aliases or certificate means a new distribution deployment | [cloudfront](../services/cloudfront.md) |
| Validation record must stay for renewal | SEC-034 |

## Open points

Cache and response-headers policies are chosen by data source (D-021); custom cache policies are not modelled. An alias from
Route 53 directly to an S3 website endpoint is not specified; this scenario is the supported way to host a static site.

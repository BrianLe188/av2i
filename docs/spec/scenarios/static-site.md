---
id: static-site
title: { vi: "Website tĩnh: S3, CloudFront, ACM, Route 53", en: "Static site: S3, CloudFront, ACM, Route 53" }
services: [s3, cloudfront, acm, route53]
executable: true
design:
  schema: 1
  name: static-site
  settings: { region: ap-southeast-1 }
  nodes:
    - { key: site, label: "Site", service: s3, props: { bucket: av2i-example-site } }
    - { key: cdn, label: "CDN", service: cloudfront, props: { enabled: true, aliases: [example.com, www.example.com], is_ipv6_enabled: true, default_root_object: index.html } }
    - { key: cert, label: "Certificate", service: acm, props: { region: us-east-1, domain_name: example.com, subject_alternative_names: [www.example.com], validation_method: DNS } }
    - { key: zone, label: "example.com", service: route53, props: { name: example.com } }
  edges:
    - { id: e_cdn_site, mechanism: origin, from: cdn, to: site }
    - { id: e_cert_cdn, mechanism: cert-attach, from: cert, to: cdn }
    - { id: e_zone_cdn, mechanism: dns-alias, from: zone, to: cdn }
expect:
  errors: []
  findings: [SEC-015, SEC-032, SEC-034]
patch_ops:
  - "see ec2-in-vpc for the six patch operations (DD-012)"
variants:
  - { id: s3-website-endpoint, change: "the origin is the S3 website endpoint", patch: [{"op": "remove-edge", "mechanism": "origin", "from": "cdn", "to": "site"}, {"op": "add-edge", "edge": {"id": "e_cdn_site2", "mechanism": "origin", "from": "cdn", "to": "site", "props": {"website_endpoint": true}}}], clears: [SEC-015], fires: [SEC-031, VAL-054, VAL-091], severity: error }
  - { id: origin-no-oac, change: "the S3 origin has no origin access control", patch: [{"op": "remove-edge", "mechanism": "origin", "from": "cdn", "to": "site"}, {"op": "add-edge", "edge": {"id": "e_cdn_site2", "mechanism": "origin", "from": "cdn", "to": "site", "props": {"access": "none"}}}], clears: [SEC-015], fires: [SEC-031, VAL-091], severity: error }
  - { id: origin-bad-signing, change: "signing_behavior never", patch: [{"op": "remove-edge", "mechanism": "origin", "from": "cdn", "to": "site"}, {"op": "add-edge", "edge": {"id": "e_cdn_site2", "mechanism": "origin", "from": "cdn", "to": "site", "props": {"signing_behavior": "never"}}}], fires: [VAL-096], severity: error }
  - { id: origin-bad-attempts, change: "5 connection attempts", patch: [{"op": "remove-edge", "mechanism": "origin", "from": "cdn", "to": "site"}, {"op": "add-edge", "edge": {"id": "e_cdn_site2", "mechanism": "origin", "from": "cdn", "to": "site", "props": {"connection_attempts": 5}}}], fires: [VAL-097], severity: error }
  - { id: origin-path, change: "an origin path", patch: [{"op": "remove-edge", "mechanism": "origin", "from": "cdn", "to": "site"}, {"op": "add-edge", "edge": {"id": "e_cdn_site2", "mechanism": "origin", "from": "cdn", "to": "site", "props": {"origin_path": "/public"}}}], fires: [], severity: info }
  - { id: bucket-acls, change: "ACLs enabled on the bucket", patch: [{"op": "set", "node": "site", "path": "props.ownership_controls", "value": {"object_ownership": "ObjectWriter"}}], fires: [SEC-014, VAL-054], severity: error }
  - { id: bucket-public, change: "block_public_policy off", patch: [{"op": "set", "node": "site", "path": "props.public_access_block", "value": {"block_public_policy": false}}], fires: [SEC-012], severity: warning }
  - { id: bucket-public-policy, change: "a public statement while block_public_policy is on", patch: [{"op": "set", "node": "site", "path": "props.bucket_policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": "*", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::av2i-example-site/*"}]}}], fires: [VAL-052], severity: error }
  - { id: bucket-source-ip, change: "a statement that uses aws:SourceIp, with an S3 endpoint in the design", patch: [{"op": "set", "node": "site", "path": "props.bucket_policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Deny", "Principal": "*", "Action": "s3:*", "Resource": "arn:aws:s3:::av2i-example-site/*", "Condition": {"NotIpAddress": {"aws:SourceIp": "203.0.113.0/24"}}}]}}, {"op": "add-node", "node": {"key": "vpc", "label": "V", "service": "vpc", "props": {"cidr_block": "10.0.0.0/16", "enable_dns_support": true, "enable_dns_hostnames": true}}}, {"op": "add-node", "node": {"key": "s3ep", "label": "E", "service": "vpc-endpoint-s3", "parent": "vpc", "props": {"policy": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": "*", "Action": ["s3:GetObject"], "Resource": ["arn:aws:s3:::av2i-example-site/*"]}]}}}}], fires: [SEC-044], severity: warning }
  - { id: bucket-with-deny, change: "the bucket policy also denies plain HTTP", patch: [{"op": "set", "node": "site", "path": "props.bucket_policy", "value": {"Version": "2012-10-17", "Statement": [{"Sid": "DenyInsecureTransport", "Effect": "Deny", "Principal": "*", "Action": "s3:*", "Resource": ["arn:aws:s3:::av2i-example-site", "arn:aws:s3:::av2i-example-site/*"], "Condition": {"Bool": {"aws:SecureTransport": "false"}}}]}}], clears: [SEC-015], fires: [], severity: info }
  - { id: cdn-no-origin, change: "the distribution has no origin", patch: [{"op": "remove-edge", "mechanism": "origin", "from": "cdn", "to": "site"}], clears: [SEC-015], fires: [VAL-092], severity: error }
  - { id: cdn-bad-behaviour-origin, change: "an ordered behaviour for an origin that does not exist", patch: [{"op": "set", "node": "cdn", "path": "props.ordered_cache_behavior", "value": [{"path_pattern": "/api/*", "origin": "nowhere"}]}], fires: [VAL-092], severity: error }
  - { id: cdn-ordered-behaviour, change: "an ordered behaviour for /assets/*", patch: [{"op": "set", "node": "cdn", "path": "props.ordered_cache_behavior", "value": [{"path_pattern": "/assets/*", "cache_policy": "Managed-CachingOptimized", "compress": true}]}], fires: [], severity: info }
  - { id: cdn-error-pages, change: "a custom error page for 404", patch: [{"op": "set", "node": "cdn", "path": "props.custom_error_response", "value": [{"error_code": 404, "response_code": 200, "response_page_path": "/index.html"}]}], fires: [], severity: info }
  - { id: cdn-half-error-page, change: "a response code without a page", patch: [{"op": "set", "node": "cdn", "path": "props.custom_error_response", "value": [{"error_code": 404, "response_code": 200}]}], fires: [VAL-092], severity: error }
  - { id: cdn-geo, change: "only viewers in Vietnam", patch: [{"op": "set", "node": "cdn", "path": "props.restrictions", "value": {"restriction_type": "whitelist", "locations": ["VN"]}}], fires: [], severity: info }
  - { id: cdn-price-class, change: "the cheapest price class", patch: [{"op": "set", "node": "cdn", "path": "props.price_class", "value": "PriceClass_100"}], fires: [], severity: info }
  - { id: cdn-allow-all, change: "viewers may use plain HTTP", patch: [{"op": "set", "node": "cdn", "path": "props.default_cache_behavior", "value": {"viewer_protocol_policy": "allow-all"}}], fires: [SEC-029], severity: warning }
  - { id: cdn-old-tls, change: "minimum protocol TLSv1", patch: [{"op": "set", "node": "cdn", "path": "props.viewer_certificate", "value": {"minimum_protocol_version": "TLSv1"}}], fires: [SEC-030], severity: warning }
  - { id: cdn-cert-and-default, change: "a certificate and the default certificate", patch: [{"op": "set", "node": "cdn", "path": "props.viewer_certificate", "value": {"cloudfront_default_certificate": true}}], fires: [VAL-094], severity: error }
  - { id: cdn-no-cert, change: "aliases without a certificate", patch: [{"op": "remove-edge", "mechanism": "cert-attach", "from": "cert", "to": "cdn"}], clears: [SEC-034], fires: [VAL-094], severity: error }
  - { id: cdn-all-methods, change: "all HTTP methods", patch: [{"op": "set", "node": "cdn", "path": "props.default_cache_behavior", "value": {"methods": "all"}}], fires: [], severity: info }
  - { id: cdn-alias-not-covered, change: "an alias the certificate does not cover", patch: [{"op": "set", "node": "cdn", "path": "props.aliases", "value": ["example.com", "www.example.com", "app.example.com"]}], fires: [VAL-093, VAL-102], severity: error }
  - { id: cdn-waf, change: "a web ACL", patch: [{"op": "set", "node": "cdn", "path": "props.web_acl_id", "value": "arn:aws:wafv2:us-east-1:123456789012:global/webacl/example/00000000-0000-0000-0000-000000000000"}], clears: [SEC-032], fires: [], severity: info }
  - { id: cert-wrong-region, change: "the certificate is created in eu-west-1", patch: [{"op": "set", "node": "cert", "path": "props.region", "value": "eu-west-1"}], fires: [VAL-101], severity: error }
  - { id: cert-many-names, change: "11 names on one certificate", patch: [{"op": "set", "node": "cert", "path": "props.subject_alternative_names", "value": ["www.example.com", "n0.example.com", "n1.example.com", "n2.example.com", "n3.example.com", "n4.example.com", "n5.example.com", "n6.example.com", "n7.example.com", "n8.example.com"]}], fires: [VAL-099], severity: error }
  - { id: cert-no-zone, change: "the zone is not in the design", patch: [{"op": "remove-node", "key": "zone"}], clears: [SEC-034], fires: [VAL-100], severity: error }
  - { id: cert-two-zones, change: "a name in a second hosted zone", patch: [{"op": "set", "node": "cert", "path": "props.subject_alternative_names", "value": ["www.example.com", "www.example.net"]}, {"op": "add-node", "node": {"key": "zone_net", "label": "example.net", "service": "route53", "props": {"name": "example.net"}}}], fires: [], severity: info }
  - { id: cert-design-region, change: "a certificate in the design's own Region", patch: [{"op": "set", "node": "cert", "path": "props.region", "value": "ap-southeast-1"}], fires: [VAL-101], severity: error }
  - { id: zone-private, change: "a private zone", patch: [{"op": "set", "node": "zone", "path": "props.private", "value": true}], fires: [VAL-088], severity: error }
  - { id: zone-no-alias-names, change: "the zone holds none of the distribution's aliases", patch: [{"op": "set", "node": "zone", "path": "props.name", "value": "example.net"}], clears: [SEC-034], fires: [VAL-088, VAL-100], severity: error }
---

# Static site

A private bucket served only through CloudFront. The bucket is never public; the distribution reads it with origin access control
and the bucket policy carries one generated statement scoped to that distribution. The certificate is created in `us-east-1`
through a provider alias (D-022) and validated in the Route 53 zone; every alias name gets A and AAAA records. This is the
executable form of [static-site-cdn](static-site-cdn.md).

## What the engine derives or generates

- The `us-east-1` provider alias, and `provider = aws.us_east_1` on the certificate and its validation.
- One validation record per distinct name, in the zone that holds it (DD-018).
- The origin access control and the bucket policy statement for `cloudfront.amazonaws.com` with `AWS:SourceArn` set to the
  distribution (DD-019).
- Cache policies by data source on their managed names (D-021).

---
id: route53
title: { vi: "Route 53 (DNS)", en: "Amazon Route 53 hosted zone and records" }
terraform:
  resources: [aws_route53_zone, aws_route53_record]
scope: global
placement: { requires: [], subnet_type: null, min_azs: null }
sources:
  S1: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/route53_zone.html.markdown
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/route53_record.html.markdown
  S3: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html
  S4: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/DNSLimitations.html
  S5: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html
  S6: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-elb-load-balancer.html
  S7: https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html
scope_note: "Public hosted zones, simple A and AAAA alias records to ALB and CloudFront, and the CNAME records that validate ACM certificates. Domain registration, private hosted zones, every routing policy other than simple, health checks, DNSSEC, query logging, Resolver and traffic flow are out of scope (decision D-020)"
properties:
  # what a node of this service carries in props: a public hosted zone and the records the user writes on it (D-020).
  # Alias records to an ALB or a distribution come from dns-alias connections; validation records from cert-validation.
  - { key: name, type: string, required: true, constraints: ["the domain name; a subdomain zone also needs an NS record in the parent zone"], src: [S1], status: verified }
  - { key: comment, type: string, default: "Managed by Terraform", src: [S1], status: verified }
  - { key: force_destroy, type: boolean, default: false, constraints: ["true deletes every record in the zone on destroy, including records created outside Terraform"], src: [S1], status: verified }
  - { key: private, type: boolean, default: false, constraints: ["a private zone needs a VPC association and is out of scope (D-020); true is reported by VAL-088 when a distribution points at it"], src: [S1], status: verified }
  - { key: records, type: json, constraints: ["a list of { name, type, ttl, records } or { name, type, alias } written by hand; the platform generates the alias and validation records itself"], src: [S2], status: verified }
parts:
  hosted_zone:
    - { key: name, type: string, required: true, constraints: ["the domain name; a subdomain zone also needs an NS record in the parent zone"], src: [S1], status: verified }
    - { key: comment, type: string, default: "Managed by Terraform", src: [S1], status: verified }
    - { key: force_destroy, type: boolean, default: false, constraints: ["true deletes every record in the zone on destroy, including records created outside Terraform"], src: [S1], status: verified }
    - { key: tags, type: map, src: [S1], status: verified }
  record:
    - { key: zone_id, type: reference, ref: route53, required: true, src: [S2], status: verified }
    - { key: name, type: string, required: true, constraints: ["fqdn is built from the zone and the name, without a trailing dot"], src: [S2], status: verified }
    - { key: type, type: enum, values: [A, AAAA, CNAME, TXT, NS, CAA, MX], required: true, constraints: ["the platform generates A and AAAA aliases and CNAME validation records; other types are out of scope"], src: [S2], status: verified }
    - { key: alias, type: object, fields: { name: "DNS name of the target", zone_id: "hosted zone ID of the target", evaluate_target_health: required }, constraints: ["conflicts with ttl and records", "exactly one of records or alias"], src: [S2], status: verified }
    - { key: ttl, type: number, constraints: ["required for non-alias records", "alias records have a fixed TTL of 60 seconds that cannot be set"], src: [S2, S3], status: verified }
    - { key: records, type: list, constraints: ["required for non-alias records", "a TXT value over 255 characters needs embedded quoting"], src: [S2], status: verified }
    - { key: allow_overwrite, type: boolean, default: false, constraints: ["lets Terraform take over an existing record, not recommended for most environments", "needed to manage the NS and SOA records a zone starts with"], src: [S2], status: verified }
limits:
  - { id: hosted_zones_per_account, value: 500, adjustable: true, src: [S4], status: verified }
  - { id: records_per_hosted_zone, value: 10000, adjustable: true, src: [S4], status: verified, note: "above 10,000 an extra charge applies" }
  - { id: records_per_record_set, value: 400, adjustable: false, src: [S4], status: verified }
  - { id: change_request_values, value: "1,000 ResourceRecord elements and 32,000 characters per request; UPSERT counts twice", adjustable: false, src: [S4], status: verified }
  - { id: health_checks, value: 200, adjustable: true, src: [S4], status: verified }
  - { id: domains_per_account, value: 20, adjustable: true, src: [S4], status: verified }
  - { id: quota_console_region, value: "Route 53 quotas are viewed and raised from US East (N. Virginia)", adjustable: false, src: [S4], status: verified }
relations: [dns-alias, cert-validation]
cost: { model: mixed, notes: "a monthly fee per hosted zone and per query; alias queries to AWS resources are not charged (S3). Prices unverified" }
status: verified
---

# Route 53 hosted zones and records

## Purpose

The DNS service. A **hosted zone** holds the records of one domain; a **record** maps a name to a value. In this
specification it does two jobs: it gives a friendly name to a load balancer or a CloudFront distribution
([dns-alias](../relations/dns-alias.md)), and it carries the records that prove domain ownership to ACM
([cert-validation](../relations/cert-validation.md)).

## Behaviour

- **A zone starts with two records,** NS and SOA. The NS records give the name servers to set at the registrar
  (`name_servers`). The domain must already use those name servers for any of this to resolve (S5, S6); registering
  a domain is out of scope.
- **Alias records** are a Route 53 extension. They point a name at selected AWS resources (CloudFront, load
  balancers, S3 website endpoints, API Gateway, another record in the same zone and others) and answer with the
  resource's current addresses, following any change (S3). Types are A or AAAA matching the query (S3).
- **Alias at the zone apex.** Unlike a CNAME, an alias can have the zone's own name, such as `example.com`
  (S3). A CNAME cannot be at the apex of a zone, including a subdomain zone, and an alias at the apex cannot point
  to a CNAME record in the same zone (S3).
- **No charge for alias queries** to AWS resources, whereas CNAME queries are charged, and a CNAME to another
  record in Route 53 is charged as two queries (S3).
- **TTL.** An alias to an AWS resource has no TTL you can set (Route 53 uses the resource's); in Terraform the
  value is fixed at 60 seconds (S2, S3). Changes generally reach all Route 53 servers within 60 seconds (S5, S6).
- **CloudFront targets** need the zone to be public, an A record and, when the distribution has IPv6 on, a second
  AAAA record; the distribution must list the name as an alternate domain name (S5). The load balancer targets use
  the load balancer's DNS name and its own hosted zone ID (S6).
- **ACM validation records** are CNAMEs whose name and value ACM supplies. They must stay in place or automatic
  renewal stops (S7).
- **Subdomain zones.** A zone for a subdomain needs an NS record in the parent zone pointing at it (S1).
- **Deleting.** `force_destroy` removes every record, including ones created outside Terraform (S1). An unset
  `force_destroy` makes Route 53 refuse to delete a zone that still has records beyond the default pair (the
  provider page states only the `true` behaviour; unverified).
- **Update rate.** Route 53 rejects a change to a zone while a previous one is still processing
  (`PriorRequestNotComplete`) and throttles API calls (S4); many records in one apply can hit it.

## Placement

Global. Not in a VPC. Reached from the internet through the name servers.

## Relations

- [dns-alias](../relations/dns-alias.md): records that point at an ALB or a CloudFront distribution.
- [cert-validation](../relations/cert-validation.md): the CNAME records for ACM.

## Failure modes

| Situation | Result |
|---|---|
| Alias with `ttl` or `records` set | Rejected: they conflict (S2). Rule [VAL-085](../rules/validation.md) |
| Alias target given the wrong hosted zone ID | Rejected or resolves nothing (S2). Rule [VAL-086](../rules/validation.md) |
| CNAME at the zone apex | Rejected (S3). Rule [VAL-087](../rules/validation.md) |
| Alias to CloudFront and the distribution lacks the alternate domain name or a covering certificate | The name does not serve the distribution (S5). Rule [VAL-088](../rules/validation.md) |
| Distribution has IPv6 on and only an A alias exists | IPv6 clients cannot use the name (S5). Rule [VAL-089](../rules/validation.md) |
| Domain's registrar not pointing at the zone's name servers | Nothing resolves (S5, S6) |
| Two changes to one zone back to back | `PriorRequestNotComplete` (S4) |
| Zone destroyed with `force_destroy` | All records lost (S1). [SEC-033](../rules/security.md) |
| NS or SOA record managed without `allow_overwrite` | Needs import first (S2) |
| Long TXT value | Needs quoting (S2). Pitfall P-055 |
| Over 10,000 records in a zone, or 500 zones | Rejected or charged (S4). Rule [VAL-090](../rules/validation.md) |

## Limits, cost, security

See front matter. Security: validation CNAMEs must not be removed while the certificate is in use
([SEC-034](../rules/security.md)).

## Terraform mapping

`aws_route53_zone` (`name`, `comment`, `force_destroy`, `tags`) and `aws_route53_record` (`zone_id`, `name`,
`type`, and either `alias { name, zone_id, evaluate_target_health }` or `ttl` and `records`). Generate one record
per name and type, and deduplicate by content (an apex and a wildcard share one ACM validation record,
[cert-validation](../relations/cert-validation.md)). Inline `vpc` blocks on a private zone conflict with
`aws_route53_zone_association` (S1); private zones are out of scope.

## Sources

S1 to S7 in the front matter.

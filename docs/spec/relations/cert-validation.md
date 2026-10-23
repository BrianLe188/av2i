---
id: cert-validation
title: { vi: "Xác thực chứng chỉ bằng DNS", en: "Certificate DNS validation" }
participants:
  - { role: certificate, service: acm }
  - { role: zone, service: route53 }
direction: acm->zone
same_vpc: false
cardinality: { certificate: many, zone: many }     # one record per distinct validation name; names of one certificate may live in different zones
user_drawn: false                                    # derived when a certificate is created; the zone is chosen by the domain
derived: true
generates:
  - { terraform: "aws_route53_record (type CNAME, name/records from domain_validation_options, ttl 60, allow_overwrite true), one per distinct record name", on: route53 }
  - { terraform: "aws_acm_certificate_validation (certificate_arn, validation_record_fqdns)", on: acm }
conditions:
  - { text: { vi: "Domain phải được ủy quyền cho hosted zone của Route 53", en: "The domain must be delegated to the Route 53 hosted zone" }, when: always }
  - { text: { vi: "Bản ghi phải được giữ lại để ACM tự gia hạn", en: "The records must stay so ACM can renew" }, when: always }
invalid_when: [VAL-099, VAL-100, VAL-102]
sources:
  S1: https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/acm_certificate.html.markdown
  S3: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/acm_certificate_validation.html.markdown
  S4: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/route53_record.html.markdown
status: verified
---

# Certificate DNS validation

## Meaning

To issue a public certificate ACM wants proof that you control each domain name. With DNS validation it gives a
CNAME record per name; creating that record in the domain's DNS is the proof. It also serves renewal: as long as the
record stays and the certificate is in use, ACM renews automatically (S1).

```
aws_acm_certificate --domain_validation_options--> aws_route53_record (CNAME) --fqdns--> aws_acm_certificate_validation (waits) --> issued
```

## Cases

| # | Situation | Result |
|---|---|---|
| 1 | Certificate for `example.com` and `www.example.com`, one public zone | Two CNAME records, one per name (S1) |
| 2 | Names `example.com` and `*.example.com` | **One** shared record (same name and value). Terraform yields two `domain_validation_options` entries with the same record, so generate one `aws_route53_record` per distinct record name, or use `allow_overwrite` (S1, S3) |
| 3 | Names in different hosted zones | Choose the `zone_id` per domain (S3). The zone must be the one the domain is delegated to |
| 4 | Domain not delegated to the Route 53 zone | Validation never completes; ACM times out after **72 hours** and a new certificate is needed (S1) |
| 5 | Record created, status still pending | It can show pending for up to 30 minutes (S1). The validation resource waits up to 75 minutes by default (S3) |
| 6 | Record name already contains the domain twice | Validation fails (S1); use the record name exactly as given |
| 7 | Record already exists (for example from an earlier certificate for the same name) | Reuse it; `allow_overwrite = true` lets Terraform take it over (S3, S4) |
| 8 | Same name requested again in another Region | The token works in any Region; the same record validates both (S1) |
| 9 | Validation CNAME deleted later | Automatic renewal stops (S1). [SEC-034](../rules/security.md) |
| 10 | Route 53 is not the DNS provider | Records must be added by hand; out of scope (S1) |
| 11 | Email validation | Not supported by this spec; a certificate cannot be switched from email to DNS (S1) |
| 12 | More than five CNAMEs chained in the DNS configuration | Validation resolution fails (S1) |
| 13 | Adding or removing a name from a certificate | The certificate is replaced, new records are needed, old ones go when unused (S2) |
| 14 | `validation_record_fqdns` omitted | The resource still waits, but does not depend on the records, so ordering can break (S3) |
| 15 | Record TTL | Not constrained by ACM; the examples use 60 seconds |

## Failure modes

A stack that hangs for 75 minutes and fails is almost always a delegation problem (case 4) or a missing record.
Duplicate-record errors come from not deduplicating the shared apex and wildcard record (case 2).

## Terraform mapping

```hcl
resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.web.domain_validation_options : o.resource_record_name => o...
  }
  allow_overwrite = true
  zone_id         = aws_route53_zone.main.zone_id
  name            = each.value[0].resource_record_name
  type            = each.value[0].resource_record_type
  records         = [each.value[0].resource_record_value]
  ttl             = 60
}
resource "aws_acm_certificate_validation" "web" {
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}
```

Keying by the **record name** (not the domain) collapses the shared apex and wildcard record into one. The page
read shows keying by `domain_name` with `allow_overwrite = true` (S3); both work, keying by record name is
cleaner and is the specification's rule. Illustrative shape.

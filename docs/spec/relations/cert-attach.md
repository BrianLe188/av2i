---
id: cert-attach
title: { vi: "Gắn chứng chỉ vào ALB hoặc CloudFront", en: "Certificate attachment" }
participants:
  - { role: certificate, service: acm }
  - { role: consumer, service: [alb, cloudfront] }
direction: acm->consumer
same_vpc: false
same_region: "alb: the certificate's Region = the load balancer's Region (unverified); cloudfront: the certificate must be in us-east-1 (verified)"
cardinality: { certificate: many, consumer: many }    # one default certificate per HTTPS listener plus extras; exactly one per distribution
user_drawn: true
generates:
  - { terraform: "aws_lb_listener.certificate_arn (default certificate); aws_lb_listener_certificate for more", on: alb }
  - { terraform: "aws_cloudfront_distribution.viewer_certificate { acm_certificate_arn, ssl_support_method = sni-only, minimum_protocol_version }", on: cloudfront }
conditions:
  - { text: { vi: "Chứng chỉ cho CloudFront phải ở us-east-1", en: "A certificate for CloudFront must be in us-east-1" }, when: "consumer is cloudfront" }
  - { text: { vi: "Chứng chỉ phải phủ mọi tên mà bên dùng phục vụ", en: "The certificate must cover every name the consumer serves" }, when: always }
invalid_when: [VAL-075, VAL-093, VAL-094, VAL-101, VAL-102]
sources:
  S1: https://docs.aws.amazon.com/acm/latest/userguide/acm-services.html
  S2: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html
  S3: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html
  S4: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/lb_listener.html.markdown
  S5: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/cloudfront_distribution.html.markdown
  S6: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-limits.html
  S7: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/acm_certificate.html.markdown
  S8: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html
status: verified          # the ALB same-Region rule is unverified
---

# Certificate attachment

## Meaning

An ALB terminates HTTPS with a certificate on its listener; a CloudFront distribution terminates it for viewers
with the viewer certificate. Both can use an ACM certificate directly, with no key handling (S1).

## Cases

| # | Situation | Result |
|---|---|---|
| 1 | HTTPS listener, one ACM certificate covering the domain | The normal case. A listener needs exactly one default certificate and an SSL policy (S3, S4) |
| 2 | HTTPS listener with no certificate | Invalid (S3, S4). Rule [VAL-075](../rules/validation.md) |
| 3 | Several domains on one listener | Add certificates with `aws_lb_listener_certificate`; the load balancer picks by name (SNI). Default certificate is added to the SNI list too (S3, S4). Up to 25 extra certificates per ALB (S6) |
| 4 | Certificate and ALB in different Regions | Not usable (`unverified`: general rule, the ELB page read does not state it). Rule [VAL-101](../rules/validation.md) |
| 5 | CloudFront viewer certificate | Must be requested or imported in **`us-east-1`** (S1, S2, S5) |
| 6 | A distribution and an ALB in one design, ALB in another Region | Two certificates: one in `us-east-1` for the distribution, one in the ALB's Region. The ALB as a CloudFront origin can use a certificate from any Region (S2) |
| 7 | Alias not covered | The distribution rejects the alias: the SAN must contain an exact match or a wildcard at the same level as the alias (S2). Rule [VAL-093](../rules/validation.md) |
| 8 | Wildcard `*.example.com` | Covers `www.example.com` but not `example.com` or `a.b.example.com`; add the apex as a second name (S2 same-level rule; apex coverage general) |
| 9 | CloudFront with several aliases | One certificate with all names as SANs; a distribution has one certificate (S8). Up to 10 names per ACM certificate by default (S1 of [acm](../services/acm.md)) |
| 10 | `ssl_support_method` | `sni-only` for the normal case; `vip` costs extra and the account has 2 dedicated-IP certificates by default (S5, S8). Required with an ACM certificate (S5) |
| 11 | `minimum_protocol_version` | Default `TLSv1` is old; examples `TLSv1.2_2021` (S5). [SEC-030](../rules/security.md) |
| 12 | Several distributions sharing a certificate | All must use the same supported HTTP versions (S2) |
| 13 | ED25519 key on an ALB | Not supported (S3). ACM issues RSA keys up to 2048 bits (S2); CloudFront supports RSA and ECDSA (S2) |
| 14 | Replacing a certificate in use | Create the new one before destroying the old (`create_before_destroy`) (S7) |
| 15 | Certificate not yet issued when the listener is created | Fails; reference the validation resource so it waits ([cert-validation](cert-validation.md)) |
| 16 | Certificate for an HTTPS target group | The ALB does not validate target certificates; none needed from ACM (S3 of [alb](../services/alb.md)) |
| 17 | Certificate on an EC2 instance | Not possible with ACM outside a Nitro Enclave (S1). Out of scope |

## Failure modes

`certificate not found` and name mismatch errors come from Region or coverage mistakes. A silent one: a listener
using a certificate whose validation never completed, so the stack waits 75 minutes and fails.

## Terraform mapping

ALB: `aws_lb_listener { protocol = "HTTPS", ssl_policy = "...", certificate_arn = aws_acm_certificate_validation.<x>.certificate_arn }`.
CloudFront: `viewer_certificate { acm_certificate_arn = ... , ssl_support_method = "sni-only", minimum_protocol_version = "TLSv1.2_2021" }`
with the certificate created through a `us-east-1` provider alias (D-022). The validation resource's `certificate_arn`
output is the one to reference so consumers wait for issuance (inferred, `unverified`).

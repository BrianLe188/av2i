---
id: acm
title: { vi: "ACM (chứng chỉ SSL/TLS)", en: "AWS Certificate Manager (ACM) public certificate" }
terraform:
  resources: [aws_acm_certificate, aws_acm_certificate_validation]
scope: regional
placement: { requires: [], subnet_type: null, min_azs: null }
sources:
  S1: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/acm_certificate.html.markdown
  S2: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/acm_certificate_validation.html.markdown
  S3: https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html
  S4: https://docs.aws.amazon.com/acm/latest/userguide/acm-limits.html
  S5: https://docs.aws.amazon.com/acm/latest/userguide/acm-services.html
  S6: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html
scope_note: "Amazon-issued public certificates validated by DNS in Route 53. Email validation, imported certificates, private CA certificates, exportable certificates and ACME are out of scope (decision D-022)"
properties:
  - key: domain_name
    type: string
    required: true
    constraints: ["the first name becomes the certificate's common name; all names are in the Subject Alternative Name extension"]
    src: [S1, S4]
    status: verified
  - key: subject_alternative_names
    type: list
    constraints: ["at most 10 domain names per certificate by default, adjustable to 100", "clearing the list to [] recreates the certificate"]
    src: [S1, S4]
    status: verified
  - key: validation_method
    type: enum
    values: [DNS]
    constraints: ["the provider also accepts EMAIL; the platform uses DNS only", "a certificate created with email validation cannot be switched to DNS"]
    src: [S1, S3]
    status: verified
  - key: key_algorithm
    type: string
    constraints: ["the provider page points to ACM's certificate characteristics for the values; RSA and ECDSA are the families, ACM issues RSA keys up to 2048 bits (S6); exact values unverified"]
    src: [S1, S6]
    status: verified
  - key: options.certificate_transparency_logging_preference
    type: enum
    values: [ENABLED, DISABLED]
    src: [S1]
    status: verified
  - key: tags
    type: map
    src: [S1]
    status: verified
exported:
  - { key: arn, src: [S1] }
  - { key: status, src: [S1] }
  - { key: domain_validation_options, shape: "set of { domain_name, resource_record_name, resource_record_type, resource_record_value }, only for DNS validation", src: [S1] }
  - { key: not_after, src: [S1] }
  - { key: renewal_summary, src: [S1] }
validation_resource:
  - { key: certificate_arn, type: reference, ref: acm, required: true, src: [S2], status: verified }
  - { key: validation_record_fqdns, type: list, constraints: ["DNS only", "makes the resource depend on the records"], src: [S2], status: verified }
  - { key: timeouts.create, default: "75m", src: [S2], status: verified }
limits:
  - { id: certificates_per_region, value: 2500, adjustable: true, src: [S4], status: verified, note: "expired and revoked certificates still count" }
  - { id: certificates_per_year, value: 5000, adjustable: true, src: [S4], status: verified, note: "last 365 days, per Region and account" }
  - { id: domain_names_per_certificate, value: 10, adjustable: true, max: 100, src: [S4], status: verified }
  - { id: dns_validation_timeout, value: "72 hours", adjustable: false, src: [S3], status: verified }
  - { id: api_rate_request_certificate, value: "5 requests per second", adjustable: false, src: [S4], status: verified }
relations: [cert-attach, cert-validation]
cost: { model: free, notes: "public certificates for integrated services have no charge (unverified); exportable certificates cost extra (S1)" }
status: verified
---

# ACM public certificate

## Purpose

Issues and renews TLS certificates for AWS services so they can serve HTTPS. Use it for the HTTPS listener of an
[alb](alb.md) and the viewer certificate of a [cloudfront](cloudfront.md) distribution. Do not use it to put a
certificate on an EC2 instance: an ACM certificate is deployed on integrated services, and attaching one to an
instance needs a Nitro Enclave or the ACME protocol, both out of scope (S5).

## Behaviour

- **Region.** A certificate lives in one Region and is used by services in that Region. **CloudFront needs the
  certificate in `us-east-1`** (S5, S6). A load balancer as a CloudFront origin can use a certificate from any
  Region (S6). So a design with both an ALB in another Region and a CloudFront distribution needs two certificates.
- **DNS validation.** ACM gives one CNAME record per domain name; adding it to the domain's DNS proves ownership. The
  record is added once and ACM renews the certificate automatically as long as the certificate is in use and the
  record stays (S3). A wildcard (`*.example.com`) and its base domain (`example.com`) get **the same record**; every
  other name has its own (S3).
- **Waiting.** `aws_acm_certificate` does not wait for issuance; `aws_acm_certificate_validation` waits (up to 75
  minutes by default) and does not itself create DNS records (S1, S2). ACM times out a validation after **72 hours**
  with status "Validation timed out" and a new certificate must be requested (S3).
- **Renewal** stops if the certificate is removed from the service using it or the validation CNAME is deleted
  (S3).
- **Replacing a certificate in use** needs `create_before_destroy`, for example when a listener uses it (S1).
- **Reuse.** Because the validation token works in any Region, the same certificate can be re-created in several
  Regions without validating again, as long as the CNAME stays (S3).
- **Integrated services only.** A certificate can be associated with Elastic Load Balancing, CloudFront, API Gateway,
  Cognito, Elastic Beanstalk, App Runner, Amplify, OpenSearch and others, and an ACME-issued certificate cannot be
  used with them (S5).
- **Quotas.** 2,500 certificates and 5,000 per year per Region and account; 10 names per certificate by default (S4).

## Placement

Regional, no VPC.

## Relations

- [cert-attach](../relations/cert-attach.md): used by an ALB listener and a CloudFront distribution.
- [cert-validation](../relations/cert-validation.md): the DNS records in Route 53 that validate it.

## Failure modes

| Situation | Result |
|---|---|
| Certificate for CloudFront requested outside `us-east-1` | Cannot be attached to the distribution (S6). Rule [VAL-101](../rules/validation.md) |
| Certificate does not cover the listener's or alias's name | The service rejects it or clients see name errors (S6). Rule [VAL-102](../rules/validation.md) |
| More than 10 names (or the raised limit) | Rejected (S4). Rule [VAL-099](../rules/validation.md) |
| Validation records not created or wrong | Stays pending, then times out after 72 hours (S3). Rule [VAL-100](../rules/validation.md) |
| Record name entered with the domain appended twice | Validation fails (S3) |
| Validation CNAME removed later | Automatic renewal stops (S3). [SEC-034](../rules/security.md) |
| Certificate replaced in use without `create_before_destroy` | The listener or distribution briefly has none, or the destroy is blocked (S1). Pitfall P-048 |
| Chain of more than five CNAMEs in the DNS configuration | Validation resolution fails (S3) |
| Switching an email-validated certificate to DNS | Not possible; recreate (S3) |

## Limits, cost, security

See front matter. Security: renewal is only as reliable as the validation record; keep it ([SEC-034](../rules/security.md)).

## Terraform mapping

`aws_acm_certificate` (`domain_name`, `subject_alternative_names`, `validation_method = "DNS"`, `lifecycle {
create_before_destroy = true }`), then one `aws_route53_record` per distinct entry of `domain_validation_options`
(see [cert-validation](../relations/cert-validation.md)), then `aws_acm_certificate_validation`
(`certificate_arn`, `validation_record_fqdns`). Consumers (`certificate_arn` on a listener, `acm_certificate_arn` on a
distribution) must reference the **validation** resource's `certificate_arn`, not the certificate's, so they wait
for issuance (S2, inferred; `unverified`). A CloudFront certificate needs a provider alias for `us-east-1`
(decision D-022).

## Sources

S1 to S6 in the front matter.

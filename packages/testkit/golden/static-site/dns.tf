resource "aws_acm_certificate" "cert" {
  provider                  = aws.us_east_1
  domain_name               = "example.com"
  subject_alternative_names = ["www.example.com"]
  validation_method         = "DNS"

  tags = {
    Name = "Certificate"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each        = { for dvo in aws_acm_certificate.cert.domain_validation_options : dvo.domain_name => { name = dvo.resource_record_name, record = dvo.resource_record_value, type = dvo.resource_record_type } }
  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.zone.zone_id
}

resource "aws_acm_certificate_validation" "cert" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.cert.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_zone" "zone" {
  name = "example.com"

  tags = {
    Name = "example.com"
  }
}

resource "aws_route53_record" "zone_example_com_a" {
  zone_id = aws_route53_zone.zone.zone_id
  name    = "example.com"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "zone_example_com_aaaa" {
  zone_id = aws_route53_zone.zone.zone_id
  name    = "example.com"
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "zone_www_example_com_a" {
  zone_id = aws_route53_zone.zone.zone_id
  name    = "www.example.com"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "zone_www_example_com_aaaa" {
  zone_id = aws_route53_zone.zone.zone_id
  name    = "www.example.com"
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}

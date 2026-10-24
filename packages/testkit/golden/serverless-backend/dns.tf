resource "aws_acm_certificate" "cert" {
  domain_name       = "api.example.com"
  validation_method = "DNS"

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
  certificate_arn         = aws_acm_certificate.cert.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_zone" "zone" {
  name = "example.com"

  tags = {
    Name = "example.com"
  }
}

resource "aws_route53_record" "zone_api_example_com_a" {
  zone_id = aws_route53_zone.zone.zone_id
  name    = "api.example.com"
  type    = "A"

  alias {
    name                   = aws_lb.alb.dns_name
    zone_id                = aws_lb.alb.zone_id
    evaluate_target_health = true
  }
}

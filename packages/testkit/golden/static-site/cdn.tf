resource "aws_cloudfront_origin_access_control" "cdn_site" {
  name                              = "cdn-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "managed_cachingoptimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  aliases             = ["example.com", "www.example.com"]
  default_root_object = "index.html"
  is_ipv6_enabled     = true

  tags = {
    Name = "CDN"
  }

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "site"
    origin_access_control_id = aws_cloudfront_origin_access_control.cdn_site.id
  }

  default_cache_behavior {
    target_origin_id       = "site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.managed_cachingoptimized.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cert.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

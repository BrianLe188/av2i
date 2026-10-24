resource "aws_lb" "alb" {
  name                       = "web-alb"
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = [aws_subnet.pub_a.id, aws_subnet.pub_b.id]
  security_groups            = [aws_security_group.sg_alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true

  depends_on = [aws_s3_bucket_policy.logs]

  tags = {
    Name = "Web ALB"
  }

  access_logs {
    bucket  = aws_s3_bucket.logs.id
    prefix  = "alb"
    enabled = true
  }
}

resource "aws_lb_listener" "alb_443" {
  load_balancer_arn = aws_lb.alb.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.cert.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.alb_web.arn
  }
}

resource "aws_lb_listener" "alb_80" {
  load_balancer_arn = aws_lb.alb.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_target_group" "alb_web" {
  name        = "alb-web"
  target_type = "ip"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.vpc.id

  tags = {
    Name = "alb-web"
  }
}

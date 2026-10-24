resource "aws_lb" "alb" {
  name                       = "api-alb"
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = [aws_subnet.pub_a.id, aws_subnet.pub_b.id]
  security_groups            = [aws_security_group.sg_alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true

  tags = {
    Name = "API ALB"
  }
}

resource "aws_lb_listener" "alb_443" {
  load_balancer_arn = aws_lb.alb.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.cert.certificate_arn

  default_action {
    type = "forward"

    forward {
      target_group {
        arn = aws_lb_target_group.alb_edge_fn.arn
      }

      target_group {
        arn = aws_lb_target_group.alb_data_fn.arn
      }
    }
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

resource "aws_lb_target_group" "alb_edge_fn" {
  name        = "alb-edge-fn"
  target_type = "lambda"

  tags = {
    Name = "alb-edge-fn"
  }
}

resource "aws_lambda_permission" "alb_edge_fn_edge_fn" {
  statement_id  = "AllowExecutionFromAlb"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.edge_fn.function_name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.alb_edge_fn.arn
}

resource "aws_lb_target_group_attachment" "alb_edge_fn_edge_fn" {
  target_group_arn = aws_lb_target_group.alb_edge_fn.arn
  target_id        = aws_lambda_function.edge_fn.arn

  depends_on = [aws_lambda_permission.alb_edge_fn_edge_fn]
}

resource "aws_lb_target_group" "alb_data_fn" {
  name        = "alb-data-fn"
  target_type = "lambda"

  tags = {
    Name = "alb-data-fn"
  }
}

resource "aws_lambda_permission" "alb_data_fn_data_fn" {
  statement_id  = "AllowExecutionFromAlb"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.data_fn.function_name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.alb_data_fn.arn
}

resource "aws_lb_target_group_attachment" "alb_data_fn_data_fn" {
  target_group_arn = aws_lb_target_group.alb_data_fn.arn
  target_id        = aws_lambda_function.data_fn.arn

  depends_on = [aws_lambda_permission.alb_data_fn_data_fn]
}

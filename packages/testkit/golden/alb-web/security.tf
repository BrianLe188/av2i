resource "aws_security_group" "sg_alb" {
  name        = "alb-sg"
  description = "Load balancer"
  vpc_id      = aws_vpc.vpc.id

  tags = {
    Name = "alb-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "sg_alb_ingress_tcp_80_0_0_0_0_0" {
  security_group_id = aws_security_group.sg_alb.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
  description       = "http"
}

resource "aws_vpc_security_group_ingress_rule" "sg_alb_ingress_tcp_443_0_0_0_0_0" {
  security_group_id = aws_security_group.sg_alb.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
  description       = "https"
}

resource "aws_vpc_security_group_egress_rule" "sg_alb_egress_all_all_0_0_0_0_0" {
  security_group_id = aws_security_group.sg_alb.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "sg_task" {
  name        = "task-sg"
  description = "ECS tasks"
  vpc_id      = aws_vpc.vpc.id

  tags = {
    Name = "task-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "sg_task_ingress_tcp_8080_sg_alb" {
  security_group_id            = aws_security_group.sg_task.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
  referenced_security_group_id = aws_security_group.sg_alb.id
  description                  = "from sg_alb"
}

resource "aws_vpc_security_group_egress_rule" "sg_task_egress_all_all_0_0_0_0_0" {
  security_group_id = aws_security_group.sg_task.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

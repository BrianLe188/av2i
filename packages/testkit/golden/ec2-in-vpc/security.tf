resource "aws_security_group" "sg_app" {
  name        = "app-sg"
  description = "Application tier"
  vpc_id      = aws_vpc.vpc.id

  tags = {
    Name = "app-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "sg_app_ingress_tcp_22_10_0_0_0_16" {
  security_group_id = aws_security_group.sg_app.id
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = "10.0.0.0/16"
  description       = "ssh from the VPC"
}

resource "aws_vpc_security_group_egress_rule" "sg_app_egress_all_all_0_0_0_0_0" {
  security_group_id = aws_security_group.sg_app.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

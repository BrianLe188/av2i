resource "aws_security_group" "sg_task" {
  name        = "task-sg"
  description = "ECS tasks"
  vpc_id      = aws_vpc.vpc.id

  tags = {
    Name = "task-sg"
  }
}

resource "aws_vpc_security_group_egress_rule" "sg_task_egress_all_all_0_0_0_0_0" {
  security_group_id = aws_security_group.sg_task.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "sg_db" {
  name        = "db-sg"
  description = "Database"
  vpc_id      = aws_vpc.vpc.id

  tags = {
    Name = "db-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "sg_db_ingress_tcp_5432_sg_task" {
  security_group_id            = aws_security_group.sg_db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.sg_task.id
  description                  = "from sg_task"
}

resource "aws_vpc_security_group_ingress_rule" "sg_db_ingress_tcp_5432_sg_fn" {
  security_group_id            = aws_security_group.sg_db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.sg_fn.id
  description                  = "from sg_fn"
}

resource "aws_vpc_security_group_egress_rule" "sg_db_egress_all_all_0_0_0_0_0" {
  security_group_id = aws_security_group.sg_db.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "sg_fn" {
  name        = "fn-sg"
  description = "Worker function"
  vpc_id      = aws_vpc.vpc.id

  tags = {
    Name = "fn-sg"
  }
}

resource "aws_vpc_security_group_egress_rule" "sg_fn_egress_all_all_0_0_0_0_0" {
  security_group_id = aws_security_group.sg_fn.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

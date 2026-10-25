resource "aws_db_subnet_group" "db_group" {
  name        = "data-db"
  description = "Managed by av2i"
  subnet_ids  = [aws_subnet.priv_a.id, aws_subnet.priv_b.id]

  tags = {
    Name = "Database subnets"
  }
}

resource "aws_db_instance" "db" {
  identifier                  = "db"
  engine                      = "postgres"
  instance_class              = "db.t3.micro"
  allocated_storage           = 20
  storage_encrypted           = true
  username                    = "app"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.db_group.name
  vpc_security_group_ids      = [aws_security_group.sg_db.id]
  publicly_accessible         = false
  backup_retention_period     = 7
  deletion_protection         = true
  skip_final_snapshot         = false
  final_snapshot_identifier   = "db-final"

  tags = {
    Name = "Database"
  }
}

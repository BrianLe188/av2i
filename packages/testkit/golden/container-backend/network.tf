resource "aws_vpc" "vpc" {
  cidr_block           = "10.2.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "Backend"
  }
}

resource "aws_default_security_group" "vpc" {
  vpc_id = aws_vpc.vpc.id
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "Internet gateway"
  }
}

resource "aws_subnet" "pub_a" {
  vpc_id            = aws_vpc.vpc.id
  cidr_block        = "10.2.0.0/24"
  availability_zone = "ap-southeast-1a"

  tags = {
    Name = "Public A"
  }
}

resource "aws_subnet" "pub_b" {
  vpc_id            = aws_vpc.vpc.id
  cidr_block        = "10.2.1.0/24"
  availability_zone = "ap-southeast-1b"

  tags = {
    Name = "Public B"
  }
}

resource "aws_subnet" "app_a" {
  vpc_id            = aws_vpc.vpc.id
  cidr_block        = "10.2.10.0/24"
  availability_zone = "ap-southeast-1a"

  tags = {
    Name = "App A"
  }
}

resource "aws_subnet" "app_b" {
  vpc_id            = aws_vpc.vpc.id
  cidr_block        = "10.2.11.0/24"
  availability_zone = "ap-southeast-1b"

  tags = {
    Name = "App B"
  }
}

resource "aws_subnet" "db_a" {
  vpc_id            = aws_vpc.vpc.id
  cidr_block        = "10.2.20.0/24"
  availability_zone = "ap-southeast-1a"

  tags = {
    Name = "Data A"
  }
}

resource "aws_subnet" "db_b" {
  vpc_id            = aws_vpc.vpc.id
  cidr_block        = "10.2.21.0/24"
  availability_zone = "ap-southeast-1b"

  tags = {
    Name = "Data B"
  }
}

resource "aws_eip" "eip_nat_a" {
  domain = "vpc"

  tags = {
    Name = "Elastic IP of NAT A"
  }

  depends_on = [aws_internet_gateway.igw]
}

resource "aws_eip" "eip_nat_b" {
  domain = "vpc"

  tags = {
    Name = "Elastic IP of NAT B"
  }

  depends_on = [aws_internet_gateway.igw]
}

resource "aws_nat_gateway" "nat_a" {
  allocation_id = aws_eip.eip_nat_a.id
  subnet_id     = aws_subnet.pub_a.id

  tags = {
    Name = "NAT A"
  }

  depends_on = [aws_internet_gateway.igw]
}

resource "aws_nat_gateway" "nat_b" {
  allocation_id = aws_eip.eip_nat_b.id
  subnet_id     = aws_subnet.pub_b.id

  tags = {
    Name = "NAT B"
  }

  depends_on = [aws_internet_gateway.igw]
}

resource "aws_route_table" "rt_public" {
  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "Public routes"
  }
}

resource "aws_route_table" "rt_app_a" {
  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "App A routes"
  }
}

resource "aws_route_table" "rt_app_b" {
  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "App B routes"
  }
}

resource "aws_route" "rt_public_default" {
  route_table_id         = aws_route_table.rt_public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.igw.id
}

resource "aws_route" "rt_app_a_default" {
  route_table_id         = aws_route_table.rt_app_a.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat_a.id
}

resource "aws_route" "rt_app_b_default" {
  route_table_id         = aws_route_table.rt_app_b.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat_b.id
}

resource "aws_route_table_association" "rt_public_pub_a" {
  subnet_id      = aws_subnet.pub_a.id
  route_table_id = aws_route_table.rt_public.id
}

resource "aws_route_table_association" "rt_public_pub_b" {
  subnet_id      = aws_subnet.pub_b.id
  route_table_id = aws_route_table.rt_public.id
}

resource "aws_route_table_association" "rt_app_a_app_a" {
  subnet_id      = aws_subnet.app_a.id
  route_table_id = aws_route_table.rt_app_a.id
}

resource "aws_route_table_association" "rt_app_b_app_b" {
  subnet_id      = aws_subnet.app_b.id
  route_table_id = aws_route_table.rt_app_b.id
}

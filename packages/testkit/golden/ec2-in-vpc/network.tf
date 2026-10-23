resource "aws_vpc" "vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "Main"
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
  cidr_block        = "10.0.0.0/24"
  availability_zone = "ap-southeast-1a"

  tags = {
    Name = "Public A"
  }
}

resource "aws_subnet" "app_a" {
  vpc_id            = aws_vpc.vpc.id
  cidr_block        = "10.0.10.0/24"
  availability_zone = "ap-southeast-1a"

  tags = {
    Name = "App A"
  }
}

resource "aws_eip" "eip_nat_a" {
  domain = "vpc"

  tags = {
    Name = "Elastic IP of NAT A"
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

resource "aws_route_table" "rt_public" {
  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "Public routes"
  }
}

resource "aws_route_table" "rt_app" {
  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "App routes"
  }
}

resource "aws_route" "rt_public_default" {
  route_table_id         = aws_route_table.rt_public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.igw.id
}

resource "aws_route" "rt_app_default" {
  route_table_id         = aws_route_table.rt_app.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat_a.id
}

resource "aws_vpc_endpoint_route_table_association" "rt_app_s3ep" {
  route_table_id  = aws_route_table.rt_app.id
  vpc_endpoint_id = aws_vpc_endpoint.s3ep.id
}

resource "aws_route_table_association" "rt_public_pub_a" {
  subnet_id      = aws_subnet.pub_a.id
  route_table_id = aws_route_table.rt_public.id
}

resource "aws_route_table_association" "rt_app_app_a" {
  subnet_id      = aws_subnet.app_a.id
  route_table_id = aws_route_table.rt_app.id
}

resource "aws_vpc_endpoint" "s3ep" {
  vpc_id            = aws_vpc.vpc.id
  service_name      = "com.amazonaws.ap-southeast-1.s3"
  vpc_endpoint_type = "Gateway"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetObject"]
        Resource  = ["arn:aws:s3:::example-bucket/*"]
      },
    ]
  })

  tags = {
    Name = "S3 endpoint"
  }
}

resource "aws_vpc" "vpc" {
  cidr_block           = "10.4.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "API"
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
  cidr_block        = "10.4.0.0/24"
  availability_zone = "ap-southeast-1a"

  tags = {
    Name = "Public A"
  }
}

resource "aws_subnet" "pub_b" {
  vpc_id            = aws_vpc.vpc.id
  cidr_block        = "10.4.1.0/24"
  availability_zone = "ap-southeast-1b"

  tags = {
    Name = "Public B"
  }
}

resource "aws_subnet" "priv_a" {
  vpc_id            = aws_vpc.vpc.id
  cidr_block        = "10.4.10.0/24"
  availability_zone = "ap-southeast-1a"

  tags = {
    Name = "Private A"
  }
}

resource "aws_subnet" "priv_b" {
  vpc_id            = aws_vpc.vpc.id
  cidr_block        = "10.4.11.0/24"
  availability_zone = "ap-southeast-1b"

  tags = {
    Name = "Private B"
  }
}

resource "aws_route_table" "rt_public" {
  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "Public routes"
  }
}

resource "aws_route_table" "rt_priv" {
  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "Private routes"
  }
}

resource "aws_route" "rt_public_default" {
  route_table_id         = aws_route_table.rt_public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.igw.id
}

resource "aws_vpc_endpoint_route_table_association" "rt_priv_s3ep" {
  route_table_id  = aws_route_table.rt_priv.id
  vpc_endpoint_id = aws_vpc_endpoint.s3ep.id
}

resource "aws_route_table_association" "rt_public_pub_a" {
  subnet_id      = aws_subnet.pub_a.id
  route_table_id = aws_route_table.rt_public.id
}

resource "aws_route_table_association" "rt_public_pub_b" {
  subnet_id      = aws_subnet.pub_b.id
  route_table_id = aws_route_table.rt_public.id
}

resource "aws_route_table_association" "rt_priv_priv_a" {
  subnet_id      = aws_subnet.priv_a.id
  route_table_id = aws_route_table.rt_priv.id
}

resource "aws_route_table_association" "rt_priv_priv_b" {
  subnet_id      = aws_subnet.priv_b.id
  route_table_id = aws_route_table.rt_priv.id
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
        Action    = ["s3:GetObject", "s3:PutObject"]
        Resource  = ["arn:aws:s3:::av2i-example-uploads/*"]
      },
    ]
  })

  tags = {
    Name = "S3 endpoint"
  }
}

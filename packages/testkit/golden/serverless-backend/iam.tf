resource "aws_iam_role" "data_role" {
  name = "api-data"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      },
    ]
  })

  tags = {
    Name = "Data role"
  }
}

resource "aws_iam_role_policy_attachment" "data_role_awslambdabasicexecutionrole" {
  role       = aws_iam_role.data_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "data_role_awslambdavpcaccessexecutionrole" {
  role       = aws_iam_role.data_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "data_role_grants" {
  name = "grants"
  role = aws_iam_role.data_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrToken"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid      = "S3ReadwriteUploads"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${aws_s3_bucket.uploads.arn}/*"]
      },
      {
        Sid      = "S3ReadwriteUploadsList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.uploads.arn]
      },
      {
        Sid      = "LambdaPullRepo"
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
        Resource = [aws_ecr_repository.repo.arn]
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "data_role_audit" {
  role       = aws_iam_role.data_role.name
  policy_arn = aws_iam_policy.audit.arn
}

resource "aws_iam_role" "role_edge_fn" {
  name = "role-edge-fn"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      },
    ]
  })

  tags = {
    Name = "Role of Edge function"
  }
}

resource "aws_iam_role_policy_attachment" "role_edge_fn_awslambdabasicexecutionrole" {
  role       = aws_iam_role.role_edge_fn.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_policy" "audit" {
  name        = "api-audit"
  description = "Publish metrics"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "Backend"
          }
        }
      },
    ]
  })

  tags = {
    Name = "Audit metrics"
  }
}

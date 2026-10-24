data "aws_caller_identity" "current" {}

resource "aws_iam_role" "task_role" {
  name = "backend-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          ArnLike = {
            "aws:SourceArn" = "arn:aws:ecs:ap-southeast-1:${data.aws_caller_identity.current.account_id}:*"
          }
        }
      },
    ]
  })

  tags = {
    Name = "Task role"
  }
}

resource "aws_iam_role_policy" "task_role_grants" {
  name = "grants"
  role = aws_iam_role.task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "S3ReadwriteFiles"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${aws_s3_bucket.files.arn}/*"]
      },
      {
        Sid      = "S3ReadwriteFilesList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.files.arn]
      },
    ]
  })
}

resource "aws_iam_role" "role_web_exec" {
  name = "role-web-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      },
    ]
  })

  tags = {
    Name = "Role of Web"
  }
}

resource "aws_iam_role_policy_attachment" "role_web_exec_amazonecstaskexecutionrolepolicy" {
  role       = aws_iam_role.role_web_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "role_fn" {
  name = "role-fn"

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
    Name = "Role of Worker"
  }
}

resource "aws_iam_role_policy_attachment" "role_fn_awslambdabasicexecutionrole" {
  role       = aws_iam_role.role_fn.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "role_fn_awslambdavpcaccessexecutionrole" {
  role       = aws_iam_role.role_fn.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

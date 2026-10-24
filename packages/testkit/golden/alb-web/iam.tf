data "aws_caller_identity" "current" {}

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

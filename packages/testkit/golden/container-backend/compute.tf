resource "aws_ecs_cluster" "cluster" {
  name = "backend"

  tags = {
    Name = "Backend cluster"
  }
}

resource "aws_ecs_task_definition" "web" {
  family                   = "web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.role_web_exec.arn
  task_role_arn            = aws_iam_role.task_role.arn

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = "${aws_ecr_repository.repo.repository_url}:v1"
      essential = true
      portMappings = [
        {
          containerPort = 8080
          protocol      = "tcp"
        },
      ]
    },
  ])
}

resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = aws_ecs_cluster.cluster.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  depends_on = [aws_iam_role_policy.task_role_grants, aws_iam_role_policy_attachment.role_web_exec_amazonecstaskexecutionrolepolicy]

  network_configuration {
    subnets          = [aws_subnet.app_a.id, aws_subnet.app_b.id]
    security_groups  = [aws_security_group.sg_task.id]
    assign_public_ip = false
  }
}

resource "aws_lambda_function" "fn" {
  function_name = "worker"
  role          = aws_iam_role.role_fn.arn
  filename      = "lambda.zip"
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  memory_size   = 256
  timeout       = 10

  tags = {
    Name = "Worker"
  }

  depends_on = [aws_iam_role_policy_attachment.role_fn_awslambdabasicexecutionrole, aws_iam_role_policy_attachment.role_fn_awslambdavpcaccessexecutionrole]

  vpc_config {
    subnet_ids         = [aws_subnet.app_a.id, aws_subnet.app_b.id]
    security_group_ids = [aws_security_group.sg_fn.id]
  }
}

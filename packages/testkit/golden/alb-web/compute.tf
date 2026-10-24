resource "aws_ecs_cluster" "cluster" {
  name = "web"

  tags = {
    Name = "Web cluster"
  }
}

resource "aws_ecs_task_definition" "web" {
  family                   = "web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.role_web_exec.arn

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = "public.ecr.aws/nginx/nginx:stable"
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

  depends_on = [aws_iam_role_policy_attachment.role_web_exec_amazonecstaskexecutionrolepolicy, aws_lb_listener.alb_443, aws_lb_listener.alb_80]

  network_configuration {
    subnets          = [aws_subnet.app_a.id, aws_subnet.app_b.id]
    security_groups  = [aws_security_group.sg_task.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.alb_web.arn
    container_name   = "web"
    container_port   = 8080
  }
}

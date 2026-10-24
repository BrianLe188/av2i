resource "aws_lambda_function" "edge_fn" {
  function_name = "edge"
  role          = aws_iam_role.role_edge_fn.arn
  filename      = "edge.zip"
  handler       = "index.handler"
  runtime       = "nodejs22.x"

  tags = {
    Name = "Edge function"
  }

  depends_on = [aws_iam_role_policy_attachment.role_edge_fn_awslambdabasicexecutionrole]
}

resource "aws_lambda_function" "data_fn" {
  function_name = "data"
  role          = aws_iam_role.data_role.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.repo.repository_url}:v1"
  timeout       = 30

  tags = {
    Name = "Data function"
  }

  depends_on = [aws_iam_role_policy_attachment.data_role_awslambdabasicexecutionrole, aws_iam_role_policy_attachment.data_role_awslambdavpcaccessexecutionrole, aws_iam_role_policy_attachment.data_role_audit, aws_iam_role_policy.data_role_grants]

  vpc_config {
    subnet_ids         = [aws_subnet.priv_a.id, aws_subnet.priv_b.id]
    security_group_ids = [aws_security_group.sg_fn.id]
  }
}

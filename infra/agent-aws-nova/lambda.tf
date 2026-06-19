resource "aws_cloudwatch_log_group" "agent" {
  name              = "/aws/lambda/${local.agent_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "agent" {
  function_name = local.agent_name
  description   = "AWS/Nova agent HTTP handler for /health, /bid, and /execute."

  role = aws_iam_role.agent_runtime.arn

  runtime = "nodejs22.x"
  # tsc emits the entry at dist/server.js (ESM; package is "type":"module"),
  # so the handler path is dist-prefixed — not bare "server.handler".
  handler     = "dist/server.handler"
  memory_size = var.agent_memory_mb
  timeout     = var.agent_timeout_seconds

  # CI passes -var="agent_lambda_s3_key=aws-nova-SHA.zip" on each deploy.
  # The default key points to the placeholder uploaded by artifacts.tf so
  # the first `terraform apply` succeeds before any CI run has run.
  s3_bucket = aws_s3_bucket.lambda_artifacts.bucket
  s3_key    = var.agent_lambda_s3_key

  environment {
    variables = {
      AGENT_ID                    = "aws-nova"
      AWS_NOVA_BID_MODEL_ID       = var.bedrock_bid_model_id
      AWS_NOVA_EXEC_MODEL_ID      = var.bedrock_execute_model_id
      JWKS_URL                    = var.jwks_url
      NODE_OPTIONS                = "--enable-source-maps"
      OTEL_EXPORTER_OTLP_ENDPOINT = var.otel_exporter_otlp_endpoint != null ? var.otel_exporter_otlp_endpoint : ""
      OTEL_EXPORTER_OTLP_HEADERS  = var.otel_exporter_otlp_headers != null ? var.otel_exporter_otlp_headers : ""
      OTEL_SERVICE_NAME           = "agent-tasker-aws-nova"
      OTEL_TRACES_EXPORTER        = var.otel_exporter_otlp_endpoint == null ? "none" : "otlp"
      POWERTOOLS_SERVICE_NAME     = "agent-aws-nova"
      POWERTOOLS_TRACE_ENABLED    = "true"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.agent,
    aws_iam_role_policy.agent_bedrock_nova,
    aws_iam_role_policy.agent_logs,
    aws_s3_object.placeholder,
  ]
}

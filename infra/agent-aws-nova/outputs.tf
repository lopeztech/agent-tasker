output "agent_runtime_role_arn" {
  description = "IAM role ARN for the AWS/Nova agent runtime. The Lambda stack in #43 assumes this role."
  value       = aws_iam_role.agent_runtime.arn
}

output "agent_runtime_role_name" {
  description = "IAM role name for the AWS/Nova agent runtime."
  value       = aws_iam_role.agent_runtime.name
}

output "agent_lambda_function_name" {
  description = "AWS/Nova Lambda function name."
  value       = aws_lambda_function.agent.function_name
}

output "agent_api_endpoint" {
  description = "HTTP API Gateway endpoint for the AWS/Nova agent. Coordinator per-agent endpoint config points at this."
  value       = aws_apigatewayv2_api.agent.api_endpoint
}

output "nova_foundation_model_arns" {
  description = "Bedrock foundation-model ARNs the AWS/Nova runtime role may invoke."
  value       = local.nova_foundation_model_arns
}

output "lambda_artifacts_bucket" {
  description = "S3 bucket name where CI uploads Lambda deployment zips. Set as AWS_LAMBDA_ARTIFACTS_BUCKET in ci.yml."
  value       = aws_s3_bucket.lambda_artifacts.bucket
}

output "cicd_role_arn" {
  description = "IAM role ARN for GitHub Actions CI/CD — set as AWS_ROLE_ARN in GitHub Actions secrets."
  value       = aws_iam_role.cicd.arn
}

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

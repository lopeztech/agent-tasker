output "ledger_table_name" {
  description = "Name of the DynamoDB ledger table."
  value       = aws_dynamodb_table.ledger.name
}

output "ledger_table_arn" {
  description = "ARN of the DynamoDB ledger table."
  value       = aws_dynamodb_table.ledger.arn
}

output "ledger_agent_index_name" {
  description = "Name of the GSI keyed on agent_id."
  value       = "agent_id-created_at-index"
}

output "ledger_agent_index_arn" {
  description = "ARN of the agent_id GSI (useful for IAM policies)."
  value       = "${aws_dynamodb_table.ledger.arn}/index/agent_id-created_at-index"
}

output "pricing_table_name" {
  description = "Name of the DynamoDB pricing table."
  value       = aws_dynamodb_table.pricing.name
}

output "pricing_table_arn" {
  description = "ARN of the DynamoDB pricing table."
  value       = aws_dynamodb_table.pricing.arn
}

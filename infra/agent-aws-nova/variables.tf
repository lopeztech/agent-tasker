variable "aws_region" {
  description = "AWS region hosting the AWS/Nova agent stack and Bedrock runtime."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name prefix used in resource naming and tags."
  type        = string
  default     = "agent-tasker"
}

variable "env" {
  description = "Environment name (e.g. dev, staging, prod). Used in resource names."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]{1,16}$", var.env))
    error_message = "env must be 1-16 chars of [a-z0-9-]."
  }
}

variable "tags" {
  description = "Extra tags to merge onto every AWS resource that supports tags."
  type        = map(string)
  default     = {}
}

variable "agent_memory_mb" {
  description = "Memory allocated to the AWS/Nova Lambda function."
  type        = number
  default     = 512
}

variable "agent_timeout_seconds" {
  description = "Lambda timeout for /bid and /execute requests. Kept below API Gateway's hard timeout; long executions move to async follow-ups if needed."
  type        = number
  default     = 29
}

variable "jwks_url" {
  description = "Coordinator JWKS URL the AWS/Nova agent will use for RS256 token verification."
  type        = string
}

variable "bedrock_bid_model_id" {
  description = "Bedrock model ID pinned for the AWS/Nova bid estimator."
  type        = string
  default     = "amazon.nova-micro-v1:0"
}

variable "bedrock_execute_model_id" {
  description = "Bedrock model ID pinned for the AWS/Nova execution model."
  type        = string
  default     = "amazon.nova-pro-v1:0"
}

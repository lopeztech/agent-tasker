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

variable "otel_exporter_otlp_endpoint" {
  description = "Optional Grafana Cloud OTLP endpoint (for example https://otlp-gateway-prod-us-central-0.grafana.net/otlp). When null, Lambda sets OTEL_TRACES_EXPORTER=none so local/dev deploys do not emit traces."
  type        = string
  default     = null
}

variable "otel_exporter_otlp_headers" {
  description = "Optional OTLP headers for Grafana Cloud, usually Authorization=Basic <base64(instance_id:token)>. Stored in Terraform state; prefer environment-specific encrypted state."
  type        = string
  default     = null
  sensitive   = true
}

variable "cost_budget_monthly_usd" {
  description = "Optional monthly AWS budget amount in whole USD. Leave null to skip budget creation."
  type        = number
  default     = null

  validation {
    condition     = var.cost_budget_monthly_usd == null || var.cost_budget_monthly_usd > 0 && floor(var.cost_budget_monthly_usd) == var.cost_budget_monthly_usd
    error_message = "cost_budget_monthly_usd must be a positive whole-dollar amount when set."
  }
}

variable "cost_budget_threshold_percents" {
  description = "Budget alert thresholds as whole percentages of monthly budget."
  type        = list(number)
  default     = [50, 80, 100]

  validation {
    condition     = length(var.cost_budget_threshold_percents) > 0 && alltrue([for p in var.cost_budget_threshold_percents : p > 0])
    error_message = "cost_budget_threshold_percents must contain at least one positive threshold."
  }
}

variable "cost_budget_alert_emails" {
  description = "Email addresses that receive AWS Budget notifications. Required when cost_budget_monthly_usd is set."
  type        = list(string)
  default     = []

  validation {
    condition     = var.cost_budget_monthly_usd == null || length(var.cost_budget_alert_emails) > 0
    error_message = "cost_budget_alert_emails must contain at least one email when cost_budget_monthly_usd is set."
  }
}

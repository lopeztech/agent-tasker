variable "subscription_id" {
  description = "Azure subscription ID hosting the Azure/GPT agent stack."
  type        = string
}

variable "tenant_id" {
  description = "Microsoft Entra tenant ID for the subscription and Key Vault access policies."
  type        = string
}

variable "resource_group_name" {
  description = "Bootstrap resource group name from infra/azure-bootstrap."
  type        = string
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
  description = "Extra tags to merge onto every Azure resource that supports tags."
  type        = map(string)
  default     = {}
}

variable "agent_image" {
  description = "Container image for the Azure/GPT agent. Defaults to Azure's hello-world image so Terraform can stand up the stack before the real image exists."
  type        = string
  default     = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
}

variable "agent_min_replicas" {
  description = "Minimum Container Apps replicas. Zero keeps the Azure/GPT agent cheap at idle."
  type        = number
  default     = 0
}

variable "agent_max_replicas" {
  description = "Maximum Container Apps replicas. This is a cost backstop for bid/execute traffic."
  type        = number
  default     = 10
}

variable "agent_cpu" {
  description = "CPU allocated to the Azure/GPT agent container."
  type        = number
  default     = 0.5
}

variable "agent_memory" {
  description = "Memory allocated to the Azure/GPT agent container."
  type        = string
  default     = "1Gi"
}

variable "agent_port" {
  description = "Container port that serves /bid, /execute, and /health."
  type        = number
  default     = 8080
}

variable "jwks_url" {
  description = "Coordinator JWKS URL the Azure/GPT agent will use for RS256 token verification."
  type        = string
}

variable "acr_login_server" {
  description = "Azure Container Registry login server hostname (e.g. myregistry.azurecr.io). From the acr_login_server output of infra/azure-bootstrap."
  type        = string
}

variable "acr_resource_id" {
  description = "Azure Container Registry resource ID. From the acr_resource_id output of infra/azure-bootstrap. Used to assign AcrPull to the Container App managed identity."
  type        = string
}

variable "azure_openai_endpoint" {
  description = "Azure OpenAI endpoint URL used by the Azure/GPT agent."
  type        = string
}

variable "azure_openai_deployment" {
  description = "Azure OpenAI deployment name pinned for the Azure/GPT execution model."
  type        = string
}

variable "azure_openai_bid_deployment" {
  description = "Azure OpenAI deployment name for the small-model bid estimator."
  type        = string
  default     = "gpt-5-mini"
}

variable "azure_openai_api_version" {
  description = "Azure OpenAI data-plane API version used by the Azure/GPT agent."
  type        = string
  default     = "2025-04-01-preview"
}

variable "deployer_object_id" {
  description = "Object ID of the identity that runs `terraform apply` and therefore needs Key Vault secret access (get/list/set/delete). Set to the CI service principal (azure-bootstrap `ci_object_id`) so CI is the steady-state deployer; defaults to the current client when null (local operator apply)."
  type        = string
  default     = null
}

variable "azure_openai_api_key_secret_name" {
  description = "Key Vault secret name that stores the Azure OpenAI API key."
  type        = string
  default     = "azure-openai-api-key"
}

variable "key_vault_name" {
  description = "Optional globally unique Key Vault name. Must be 3-24 alphanumeric/hyphen chars, start with a letter, and end with a letter or number."
  type        = string
  default     = null

  validation {
    condition     = var.key_vault_name == null || can(regex("^[A-Za-z][A-Za-z0-9-]{1,22}[A-Za-z0-9]$", var.key_vault_name))
    error_message = "key_vault_name must be 3-24 chars, start with a letter, and end with a letter or number."
  }
}

variable "azure_openai_api_key" {
  description = "Optional Azure OpenAI API key to write into Key Vault. Leave null when the secret is managed out-of-band."
  type        = string
  default     = null
  sensitive   = true
}

variable "otel_exporter_otlp_endpoint" {
  description = "Optional Grafana Cloud OTLP endpoint (for example https://otlp-gateway-prod-us-central-0.grafana.net/otlp). When null, Container Apps sets OTEL_TRACES_EXPORTER=none so local/dev deploys do not emit traces."
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
  description = "Optional monthly Azure budget amount in whole USD. Leave null to skip budget creation."
  type        = number
  default     = null

  validation {
    condition     = var.cost_budget_monthly_usd == null || var.cost_budget_monthly_usd > 0 && floor(var.cost_budget_monthly_usd) == var.cost_budget_monthly_usd
    error_message = "cost_budget_monthly_usd must be a positive whole-dollar amount when set."
  }
}

variable "cost_budget_start_date" {
  description = "Budget start date in RFC3339 format. Required when cost_budget_monthly_usd is set; Azure requires this to be a valid budget period boundary."
  type        = string
  default     = null

  validation {
    condition     = var.cost_budget_monthly_usd == null || var.cost_budget_start_date != null
    error_message = "cost_budget_start_date is required when cost_budget_monthly_usd is set."
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
  description = "Email addresses that receive Azure Cost Management budget notifications. Required when cost_budget_monthly_usd is set."
  type        = list(string)
  default     = []

  validation {
    condition     = var.cost_budget_monthly_usd == null || length(var.cost_budget_alert_emails) > 0
    error_message = "cost_budget_alert_emails must contain at least one email when cost_budget_monthly_usd is set."
  }
}

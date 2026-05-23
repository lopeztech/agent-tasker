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

variable "azure_openai_endpoint" {
  description = "Azure OpenAI endpoint URL used by the Azure/GPT agent."
  type        = string
}

variable "azure_openai_deployment" {
  description = "Azure OpenAI deployment name pinned for the Azure/GPT execution model."
  type        = string
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

variable "subscription_id" {
  description = "Azure subscription ID that will host the Phase 3 Azure/GPT agent resources."
  type        = string
}

variable "tenant_id" {
  description = "Microsoft Entra tenant ID for the subscription and app registrations."
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

variable "location" {
  description = "Azure region for the bootstrap resource group and Terraform state storage."
  type        = string
  default     = "eastus"
}

variable "tags" {
  description = "Extra tags to merge onto every Azure resource that supports tags."
  type        = map(string)
  default     = {}
}

variable "storage_account_name" {
  description = "Optional globally unique Azure Storage account name for Terraform state. Must be 3-24 lowercase letters/numbers. Defaults to a deterministic project/env name."
  type        = string
  default     = null

  validation {
    condition     = var.storage_account_name == null || can(regex("^[a-z0-9]{3,24}$", var.storage_account_name))
    error_message = "storage_account_name must be 3-24 chars of [a-z0-9]."
  }
}

variable "storage_account_suffix" {
  description = "Optional lowercase alphanumeric suffix to make the default state storage account name globally unique."
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^[a-z0-9]{0,8}$", var.storage_account_suffix))
    error_message = "storage_account_suffix must be 0-8 chars of [a-z0-9]."
  }
}

variable "state_container_name" {
  description = "Blob container name for Terraform state."
  type        = string
  default     = "tfstate"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.state_container_name))
    error_message = "state_container_name must be a valid Azure Blob container name."
  }
}

variable "github_owner" {
  description = "GitHub organization/user that owns the repository using the CI service principal."
  type        = string
  default     = "lopeztech"
}

variable "github_repository" {
  description = "GitHub repository name using the CI service principal."
  type        = string
  default     = "agent-tasker"
}

variable "github_branch" {
  description = "GitHub branch allowed to use the CI service principal via OIDC."
  type        = string
  default     = "main"
}

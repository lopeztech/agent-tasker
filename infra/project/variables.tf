variable "project_id" {
  description = "Existing GCP project ID. Project must be created and have a billing account attached before terraform apply (see backend.hcl.example for bootstrap steps)."
  type        = string
}

variable "project" {
  description = "Project name prefix used in resource naming and labels (not the GCP project ID)."
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

variable "region" {
  description = "Default GCP region for regional resources."
  type        = string
  default     = "us-central1"
}

variable "labels" {
  description = "Extra labels to merge onto every resource."
  type        = map(string)
  default     = {}
}

variable "github_repo" {
  description = "GitHub repository in owner/repo format (e.g. lopeztech/agent-tasker). Used to scope the WIF attribute condition so only tokens from this repo can impersonate the CI SA."
  type        = string
  default     = "lopeztech/agent-tasker"
}

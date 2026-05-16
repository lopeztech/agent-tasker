variable "project" {
  description = "Project name prefix used for all resources."
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
  description = "AWS region for the coordinator stack."
  type        = string
  default     = "us-east-1"
}

variable "tags" {
  description = "Extra tags to merge onto every resource."
  type        = map(string)
  default     = {}
}

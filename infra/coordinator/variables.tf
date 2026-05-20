variable "project_id" {
  description = "GCP project ID. Must be bootstrapped via infra/project first."
  type        = string
}

variable "project" {
  description = "Project name prefix used in resource naming and labels."
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
  description = "GCP region for the coordinator stack."
  type        = string
  default     = "us-central1"
}

variable "labels" {
  description = "Extra labels to merge onto every resource."
  type        = map(string)
  default     = {}
}

variable "firestore_location" {
  description = "Firestore database location. Multi-region (`nam5`, `eur3`) recommended for durability; single-region (`us-central1`, etc.) is cheaper. One Firestore database per project — once set this cannot change."
  type        = string
  default     = "nam5"
}

variable "firestore_delete_protection" {
  description = "Whether the GCP-side delete-protection flag is enabled on the Firestore database. Defaults to disabled so dev environments can iterate quickly; set to true in prod to require a Terraform-driven flag flip before destroy is permitted."
  type        = bool
  default     = false
}

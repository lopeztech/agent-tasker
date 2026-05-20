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

variable "jwks_bucket_location" {
  description = "Location for the JWKS GCS bucket. Multi-region (`US`, `EU`) recommended for low-latency reads from anywhere; single-region (`us-central1`, etc.) is cheaper. Phase 1 traffic is intra-project so this rarely matters."
  type        = string
  default     = "US"
}

variable "jwks_delete_protection" {
  description = "Whether `terraform destroy` is allowed to delete the JWKS bucket. False in dev for iteration; true in prod so accidental destroys don't drop the published public keys (which would break every in-flight token)."
  type        = bool
  default     = false
}

variable "coordinator_image" {
  description = "Fully-qualified container image for the coordinator Cloud Run service (e.g. us-central1-docker.pkg.dev/PROJECT/agent-tasker-dev-coordinator/coordinator:abc123). Defaults to Google's hello placeholder so `terraform apply` succeeds on a fresh project before the real image has been built and pushed."
  type        = string
  default     = "gcr.io/cloudrun/hello"
}

variable "coordinator_min_instances" {
  description = "Minimum Cloud Run instances. Zero scales to nothing at idle; bump to 1 for prod-grade warm-start behavior."
  type        = number
  default     = 0
}

variable "coordinator_max_instances" {
  description = "Cloud Run autoscale cap. Acts as a cost backstop more than a capacity ceiling — the in-process auction kickoff per request is cheap."
  type        = number
  default     = 10
}

variable "coordinator_request_timeout_seconds" {
  description = "Per-request timeout. Must exceed the adaptive bid window cap (5s from CLAUDE.md) plus expected execute latency. 60s gives plenty of headroom."
  type        = number
  default     = 60
}

variable "coordinator_delete_protection" {
  description = "Cloud Run service-level delete protection. False in dev for iteration; true in prod."
  type        = bool
  default     = false
}

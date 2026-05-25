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
  description = "GCP region for the agent's Cloud Run service. Must match the Vertex AI publisher location for the pinned Gemini models."
  type        = string
  default     = "us-central1"
}

variable "labels" {
  description = "Extra labels to merge onto every resource."
  type        = map(string)
  default     = {}
}

variable "agent_image" {
  description = "Fully-qualified container image (LOCATION-docker.pkg.dev/PROJECT/REPO/gcp-gemini:TAG). Defaults to Google's hello placeholder so `terraform apply` succeeds on a fresh project before the real image is built and pushed."
  type        = string
  default     = "gcr.io/cloudrun/hello"
}

variable "agent_min_instances" {
  description = "Minimum Cloud Run instances. Zero scales to nothing at idle; bump to 1 for prod-grade warm-start."
  type        = number
  default     = 0
}

variable "agent_max_instances" {
  description = "Cloud Run autoscale cap. /bid and /execute are per-request and cheap; cap is a cost backstop, not a capacity ceiling."
  type        = number
  default     = 10
}

variable "agent_request_timeout_seconds" {
  description = "Per-request timeout. /execute against Gemini 2.5 Pro can run multiple minutes for long outputs; 300s gives plenty of headroom."
  type        = number
  default     = 300
}

variable "agent_delete_protection" {
  description = "Cloud Run service-level delete protection. False in dev for iteration; true in prod."
  type        = bool
  default     = false
}

variable "coordinator_service_account_email" {
  description = "Coordinator runtime SA email (output `coordinator_service_account_email` from infra/coordinator). The only principal granted `roles/run.invoker` on this agent."
  type        = string
}

variable "jwks_url" {
  description = "Coordinator JWKS URL (output `jwks_public_url` from infra/coordinator) the agent fetches public keys from."
  type        = string
}

variable "otel_exporter_otlp_endpoint" {
  description = "Optional Grafana Cloud OTLP endpoint (for example https://otlp-gateway-prod-us-central-0.grafana.net/otlp). When null, Cloud Run sets OTEL_TRACES_EXPORTER=none so local/dev deploys do not emit traces."
  type        = string
  default     = null
}

variable "otel_exporter_otlp_headers" {
  description = "Optional OTLP headers for Grafana Cloud, usually Authorization=Basic <base64(instance_id:token)>. Stored in Terraform state; prefer environment-specific encrypted state."
  type        = string
  default     = null
  sensitive   = true
}

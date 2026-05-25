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
  description = "GCP region for the agent's Cloud Run service. Must match the Vertex AI and Gemini Enterprise runtime location."
  type        = string
  default     = "us-central1"
}

variable "labels" {
  description = "Extra labels to merge onto every resource."
  type        = map(string)
  default     = {}
}

variable "agent_image" {
  description = "Fully-qualified container image (LOCATION-docker.pkg.dev/PROJECT/REPO/gcp-orchestrator:TAG). Defaults to Google's hello placeholder so `terraform apply` succeeds on a fresh project before the real image is built and pushed."
  type        = string
  default     = "gcr.io/cloudrun/hello"
}

variable "agent_min_instances" {
  description = "Minimum Cloud Run instances. Zero scales to nothing at idle; bump to 1 for prod-grade warm-start."
  type        = number
  default     = 0
}

variable "agent_max_instances" {
  description = "Cloud Run autoscale cap. The orchestrator can run longer execute calls, but concurrency remains per-request."
  type        = number
  default     = 10
}

variable "agent_request_timeout_seconds" {
  description = "Per-request timeout. GAEP-backed execution can take multiple tool-using steps, so this stack gets more headroom than direct Gemini."
  type        = number
  default     = 540
}

variable "agent_delete_protection" {
  description = "Cloud Run service-level delete protection. False in dev for iteration; true in prod."
  type        = bool
  default     = false
}

variable "gaep_agent_execution_roles" {
  description = "Additional project IAM roles required for the GCP/Orchestrator runtime to execute Gemini Enterprise / GAEP resources. Keep this separate from the direct GCP/Gemini SA and override if the GAEP app needs narrower or additional roles."
  type        = set(string)
  default = [
    "roles/discoveryengine.agentspaceUser",
  ]
}

variable "gaep_agent_resource_name" {
  description = "Optional fully-qualified Gemini Enterprise / GAEP agent resource name. Left empty until the runtime app is created in the follow-up shim work."
  type        = string
  default     = ""
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

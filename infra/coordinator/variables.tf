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

variable "gcp_gemini_agent_url" {
  description = "Base URL for the GCP/Gemini agent Cloud Run service. Set to the Cloud Run service URL after infra/agent-gcp-gemini is applied."
  type        = string
  default     = ""
}

variable "gcp_orchestrator_agent_url" {
  description = "Base URL for the GCP/Orchestrator agent Cloud Run service. Set to the Cloud Run service URL after infra/agent-gcp-orchestrator is applied."
  type        = string
  default     = ""
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

variable "pricing_refresh_schedule" {
  description = "Cron expression (Etc/UTC) for the daily pricing-refresh job. Default 04:00 UTC — overnight in the Americas, mid-morning in EU, low coordinator traffic everywhere."
  type        = string
  default     = "0 4 * * *"
}

variable "pricing_refresh_delete_protection" {
  description = "Whether `terraform destroy` is allowed to delete the function-source bucket. False in dev (rapid iteration); true in prod (rollback-from-archived-version is the recovery path)."
  type        = bool
  default     = false
}

variable "pricing_refresh_alert_notification_channels" {
  description = "Optional Cloud Monitoring notification channel resource names for pricing-refresh failure alerts. Leave empty to create the policy without paging until channels are provisioned."
  type        = list(string)
  default     = []
}

variable "jwks_rotation_alert_notification_channels" {
  description = "Optional Cloud Monitoring notification channel resource names for JWKS rotation health alerts. Leave empty to create the policy without notifications while bootstrapping."
  type        = list(string)
  default     = []
}

variable "billing_account_id" {
  description = "Optional GCP billing account ID used to create a project-scoped Cloud Billing budget. Leave null to skip budget creation."
  type        = string
  default     = null

  validation {
    condition     = var.cost_budget_monthly_usd == null || var.billing_account_id != null
    error_message = "billing_account_id is required when cost_budget_monthly_usd is set."
  }
}

variable "cost_budget_monthly_usd" {
  description = "Optional monthly GCP budget amount in whole USD. Leave null to skip budget creation."
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

variable "cost_budget_alert_notification_channels" {
  description = "Cloud Monitoring notification channel resource names to attach to the GCP billing budget. If empty, Billing uses default IAM recipients."
  type        = list(string)
  default     = []
}

variable "ledger_bigquery_export_enabled" {
  description = "Whether to provision scheduled Firestore ledger export into BigQuery analytical tables."
  type        = bool
  default     = false
}

variable "ledger_bigquery_dataset_id" {
  description = "BigQuery dataset ID for exported ledger tables."
  type        = string
  default     = "agent_tasker_ledger"

  validation {
    condition     = can(regex("^[A-Za-z_][A-Za-z0-9_]*$", var.ledger_bigquery_dataset_id)) && length(var.ledger_bigquery_dataset_id) <= 1024
    error_message = "ledger_bigquery_dataset_id must be a valid BigQuery dataset ID."
  }
}

variable "ledger_bigquery_location" {
  description = "BigQuery dataset location for ledger exports."
  type        = string
  default     = "US"
}

variable "ledger_bigquery_table_delete_protection" {
  description = "Whether BigQuery table deletion protection is enabled for ledger export tables."
  type        = bool
  default     = true
}

variable "ledger_bigquery_table_expiration_days" {
  description = "Optional default table expiration in days for the ledger export dataset. Leave null to keep analytical tables indefinitely."
  type        = number
  default     = null

  validation {
    condition     = var.ledger_bigquery_table_expiration_days == null || var.ledger_bigquery_table_expiration_days > 0
    error_message = "ledger_bigquery_table_expiration_days must be positive when set."
  }
}

variable "ledger_bigquery_export_schedule" {
  description = "Cron expression (Etc/UTC) for scheduled Firestore ledger export to BigQuery."
  type        = string
  default     = "30 4 * * *"
}

variable "ledger_bigquery_export_lookback_hours" {
  description = "How many hours of recently updated task documents each scheduled ledger export scans."
  type        = number
  default     = 24

  validation {
    condition     = var.ledger_bigquery_export_lookback_hours > 0
    error_message = "ledger_bigquery_export_lookback_hours must be positive."
  }
}

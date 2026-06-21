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
  description = "GCP region for the console's Cloud Run service. Must be a region that supports Cloud Run domain mappings (us-central1 does)."
  type        = string
  default     = "us-central1"
}

variable "labels" {
  description = "Extra labels to merge onto every resource."
  type        = map(string)
  default     = {}
}

variable "console_image" {
  description = "Fully-qualified container image (LOCATION-docker.pkg.dev/PROJECT/REPO/operator-console:TAG). Defaults to Google's hello placeholder so `terraform apply` succeeds on a fresh project before the real image is built and pushed."
  type        = string
  default     = "gcr.io/cloudrun/hello"
}

variable "console_min_instances" {
  description = "Minimum Cloud Run instances. Zero scales to nothing at idle (a static site cold-starts fast); bump to 1 to keep it always warm."
  type        = number
  default     = 0
}

variable "console_max_instances" {
  description = "Cloud Run autoscale cap. Static serving is cheap; this is a cost backstop, not a capacity ceiling."
  type        = number
  default     = 4
}

variable "console_delete_protection" {
  description = "Cloud Run service-level delete protection. False in dev for iteration; true in prod."
  type        = bool
  default     = false
}

variable "custom_domain" {
  description = "Custom domain the console is served at. Must be a subdomain of cloudflare_zone_name and verified for the deploying account (see README)."
  type        = string
  default     = "tasker.lopezcloud.dev"
}

variable "manage_dns" {
  description = "Whether Terraform creates the Cloudflare DNS record. When false, only GCP resources are managed and the CNAME target is exposed via the dns_record_target output for manual entry — cloudflare_api_token may then be empty."
  type        = bool
  default     = true
}

variable "cloudflare_zone_name" {
  description = "Cloudflare zone (apex domain) that custom_domain lives under, e.g. lopezcloud.dev."
  type        = string
  default     = "lopezcloud.dev"
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token scoped to Zone:DNS:Edit + Zone:Read on the zone. Supplied via TF_VAR_cloudflare_api_token (GitHub secret CLOUDFLARE_API_TOKEN); never committed. May be empty when manage_dns = false."
  type        = string
  default     = ""
  sensitive   = true
}

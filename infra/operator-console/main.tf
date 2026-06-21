provider "google" {
  project = var.project_id
  region  = var.region

  default_labels = local.common_labels
}

provider "google-beta" {
  project = var.project_id
  region  = var.region

  default_labels = local.common_labels
}

# DNS for the console's custom domain lives in Cloudflare. The token is
# supplied at apply time (TF_VAR_cloudflare_api_token / GitHub secret), never
# committed. When var.manage_dns is false the token may be empty — no
# Cloudflare resource is evaluated, so provider auth is never exercised.
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

locals {
  name_prefix = "${var.project}-${var.env}"

  # The DNS record label relative to the zone apex, e.g.
  # "tasker.lopezcloud.dev" in zone "lopezcloud.dev" → "tasker".
  dns_record_name = replace(var.custom_domain, ".${var.cloudflare_zone_name}", "")

  common_labels = merge(
    {
      project = var.project
      env     = var.env
      module  = "operator-console"
    },
    var.labels,
  )
}

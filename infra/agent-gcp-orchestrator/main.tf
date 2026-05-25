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

locals {
  name_prefix = "${var.project}-${var.env}"
  # Service account IDs cap at 30 chars, shorter than Cloud Run service names.
  agent_service_account_id = "${substr(var.project, 0, 12)}-${substr(var.env, 0, 8)}-orch"

  common_labels = merge(
    {
      project = var.project
      env     = var.env
      module  = "agent-gcp-orchestrator"
    },
    var.labels,
  )
}

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

# Restore default org-policy for allowed IAM members so `allUsers` grants
# work on Cloud Run and GCS (needed for the public coordinator API and the
# JWKS bucket). Without this, org policies inherited from the Google Workspace
# domain block principal types outside the customer domain.
resource "google_project_organization_policy" "allow_public_iam" {
  project    = var.project_id
  constraint = "iam.allowedPolicyMemberDomains"

  restore_policy {
    default = true
  }
}

locals {
  name_prefix = "${var.project}-${var.env}"

  common_labels = merge(
    {
      project = var.project
      env     = var.env
      module  = "coordinator"
    },
    var.labels,
  )
}

# Workload Identity Federation for GitHub Actions CI/CD.
#
# After applying, copy the two output values into GitHub Actions secrets
# (Settings → Secrets and variables → Actions → New repository secret):
#
#   GCP_WORKLOAD_IDENTITY_PROVIDER  ← workload_identity_provider output
#   GCP_SERVICE_ACCOUNT             ← cicd_service_account_email output

resource "google_iam_workload_identity_pool" "github_actions" {
  project                   = var.project_id
  workload_identity_pool_id = "${local.name_prefix}-github"
  display_name              = "GitHub Actions"
  description               = "WIF pool for GitHub Actions CI/CD deploys"

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github_actions.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }

  # Scope to this repo so tokens from forks cannot impersonate the CI SA.
  attribute_condition = "assertion.repository == \"${var.github_repo}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "cicd" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-cicd"
  display_name = "CI/CD deploy"
  description  = "Identity for GitHub Actions CI/CD — pushes images to Artifact Registry and updates Cloud Run services."

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "cicd_ar_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.cicd.email}"
}

resource "google_project_iam_member" "cicd_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.cicd.email}"
}

# Allow the WIF principal set (any token from this repo) to impersonate
# the CI SA. Scoped to attribute.repository so job tokens from other repos
# in the same org cannot exchange for this identity.
resource "google_service_account_iam_member" "cicd_wif" {
  service_account_id = google_service_account.cicd.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github_actions.name}/attribute.repository/${var.github_repo}"
}

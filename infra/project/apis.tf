# APIs required across the project. Phase 1 minimum plus the small set
# already known to be needed downstream — enabling APIs is idempotent and
# free; the cost of forgetting one is debugging time, not dollars.
locals {
  required_apis = toset([
    "aiplatform.googleapis.com",           # Vertex AI (Gemini direct + GAEP execution)
    "artifactregistry.googleapis.com",     # container images for Cloud Run
    "cloudbuild.googleapis.com",           # building Cloud Run containers
    "cloudfunctions.googleapis.com",       # pricing refresh function (#35)
    "cloudresourcemanager.googleapis.com", # required by the google provider to read project services (CI SA path)
    "cloudscheduler.googleapis.com",       # pricing refresh trigger (#35)
    "compute.googleapis.com",              # backbone for Cloud Run / external HTTPS LB
    "discoveryengine.googleapis.com",      # Gemini Enterprise / GAEP orchestrator agent (#90)
    "firestore.googleapis.com",            # ledger + pricing collections (#20, #24)
    "iam.googleapis.com",                  # SAs + IAM
    "iamcredentials.googleapis.com",       # SA impersonation (CI, local dev)
    "logging.googleapis.com",              # Cloud Logging
    "monitoring.googleapis.com",           # Cloud Monitoring
    "run.googleapis.com",                  # Cloud Run (coordinator + agents)
    "secretmanager.googleapis.com",        # JWT signing key (#25) + agent secrets
    "serviceusage.googleapis.com",         # required for google_project_service itself
    "storage.googleapis.com",              # JWKS bucket (#26) + tf state bucket
    "sts.googleapis.com",                  # Security Token Service — required for WIF token exchange
  ])
}

resource "google_project_service" "required" {
  for_each = local.required_apis

  project = var.project_id
  service = each.value

  disable_on_destroy         = false
  disable_dependent_services = false
}

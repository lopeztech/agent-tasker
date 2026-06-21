resource "google_artifact_registry_repository" "console" {
  project       = var.project_id
  location      = var.region
  repository_id = "${local.name_prefix}-operator-console"
  description   = "Container images for the operator console (static Market Terminal SPA)"
  format        = "DOCKER"
}

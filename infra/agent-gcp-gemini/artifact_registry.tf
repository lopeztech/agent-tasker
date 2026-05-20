resource "google_artifact_registry_repository" "agent" {
  project       = var.project_id
  location      = var.region
  repository_id = "${local.name_prefix}-gcp-gemini"
  description   = "Container images for the GCP/Gemini agent"
  format        = "DOCKER"
}

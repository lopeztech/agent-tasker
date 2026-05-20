# Docker repository for coordinator container images. Per-service repos
# keep listings sane and let per-service cleanup policies diverge later
# (e.g. coordinator retains 30 days, agent images retain 14 — TBD).
resource "google_artifact_registry_repository" "coordinator" {
  project       = var.project_id
  location      = var.region
  repository_id = "${local.name_prefix}-coordinator"
  description   = "Container images for the coordinator service"
  format        = "DOCKER"
}

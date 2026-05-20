output "firestore_database_name" {
  description = "Logical name of the Firestore database — always `(default)` for the project's primary database."
  value       = google_firestore_database.default.name
}

output "firestore_location_id" {
  description = "Location the Firestore database was provisioned in. Cannot be changed after creation."
  value       = google_firestore_database.default.location_id
}

output "jwks_bucket_name" {
  description = "Name of the GCS bucket holding the JWKS document. Used by the coordinator's publish helper when rotating keys."
  value       = google_storage_bucket.jwks.name
}

output "jwks_public_url" {
  description = "Stable public URL each agent's verifier fetches to read coordinator public keys. Object `jwks.json` is published out-of-band by the coordinator at startup / key rotation."
  value       = "https://storage.googleapis.com/${google_storage_bucket.jwks.name}/jwks.json"
}

output "coordinator_url" {
  description = "Auto-generated Cloud Run URL for the coordinator. SPA points at this. Replace with a custom-domain mapping when one is registered."
  value       = google_cloud_run_v2_service.coordinator.uri
}

output "coordinator_service_account_email" {
  description = "Coordinator runtime SA. Agents (in their own Terraform modules) grant this principal `roles/run.invoker` so it can call /bid /award /execute /reject."
  value       = google_service_account.coordinator_runtime.email
}

output "coordinator_image_repo" {
  description = "Artifact Registry path agent CI/CD pushes coordinator images to. Format: LOCATION-docker.pkg.dev/PROJECT/REPO."
  value       = "${google_artifact_registry_repository.coordinator.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.coordinator.repository_id}"
}

output "agent_url" {
  description = "Auto-generated Cloud Run URL for the GCP/Orchestrator agent. Coordinator's per-agent endpoint config points at this."
  value       = google_cloud_run_v2_service.agent.uri
}

output "agent_service_account_email" {
  description = "GCP/Orchestrator runtime SA. Useful for cross-module IAM checks (e.g. confirming this SA is *not* on the direct GCP/Gemini service)."
  value       = google_service_account.agent_runtime.email
}

output "agent_image_repo" {
  description = "Artifact Registry path CI/CD pushes GCP/Orchestrator agent images to. Format: LOCATION-docker.pkg.dev/PROJECT/REPO."
  value       = "${google_artifact_registry_repository.agent.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.agent.repository_id}"
}

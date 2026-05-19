output "project_id" {
  description = "The GCP project ID this stack bootstraps."
  value       = var.project_id
}

output "region" {
  description = "Default region for regional resources."
  value       = var.region
}

output "coordinator_sa_email" {
  description = "Service account email used by the coordinator runtime. Grant Firestore RW, Secret Manager read, and run.invoker (on each agent service) to this SA in their respective stacks."
  value       = google_service_account.coordinator.email
}

output "coordinator_sa_name" {
  description = "Fully-qualified service account name (projects/PROJECT/serviceAccounts/EMAIL)."
  value       = google_service_account.coordinator.name
}

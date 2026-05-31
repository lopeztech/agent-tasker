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

output "workload_identity_provider" {
  description = "Full WIF provider resource name — set as GCP_WORKLOAD_IDENTITY_PROVIDER in GitHub Actions secrets."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "cicd_service_account_email" {
  description = "CI/CD deploy SA email — set as GCP_SERVICE_ACCOUNT in GitHub Actions secrets."
  value       = google_service_account.cicd.email
}

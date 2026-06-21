output "console_url" {
  description = "Auto-generated Cloud Run URL for the operator console. Reachable directly; the custom domain is the primary entry point."
  value       = google_cloud_run_v2_service.console.uri
}

output "console_custom_domain_url" {
  description = "Primary URL once DNS + the managed cert are live."
  value       = "https://${var.custom_domain}"
}

output "console_service_account_email" {
  description = "Operator console runtime SA."
  value       = google_service_account.console_runtime.email
}

output "console_image_repo" {
  description = "Artifact Registry path CI/CD pushes operator console images to. Format: LOCATION-docker.pkg.dev/PROJECT/REPO."
  value       = "${google_artifact_registry_repository.console.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.console.repository_id}"
}

output "dns_record_target" {
  description = "CNAME target for the custom domain. Terraform creates this in Cloudflare when manage_dns = true; otherwise create it by hand (DNS-only / grey cloud)."
  value = {
    name    = var.custom_domain
    type    = "CNAME"
    value   = "ghs.googlehosted.com"
    proxied = false
  }
}

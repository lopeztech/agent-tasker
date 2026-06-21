# Bind the custom domain to the Cloud Run service and let Google provision +
# renew a managed TLS certificate for it. This is the no-load-balancer path:
# the only public IP is Google's anycast frontend, and the cert is issued once
# the Cloudflare CNAME (cloudflare.tf) resolves to ghs.googlehosted.com.
#
# PREREQUISITE — one-time domain-ownership verification:
#   Cloud Run will not create a mapping for a domain the deploying account
#   hasn't verified. Verify once (adds a TXT record you create in Cloudflare):
#     gcloud domains verify lopezcloud.dev
#   then add the deploy/CI service account as a verified owner in Search
#   Console (https://search.google.com/search-console). See README.md.
resource "google_cloud_run_domain_mapping" "console" {
  location = var.region
  name     = var.custom_domain
  project  = var.project_id

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.console.name
  }
}

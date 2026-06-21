# Cloudflare DNS for the console's custom domain.
#
# The record is DNS-only (grey cloud, proxied = false) on purpose: Google must
# see the real CNAME to ghs.googlehosted.com to validate the domain and serve
# the managed cert (domain_mapping.tf). Proxying through Cloudflare here would
# break managed-cert issuance and double-terminate TLS. If edge caching is
# wanted later, switch to the GCS + HTTPS LB + Cloud CDN path and front that
# with a proxied record instead.
#
# Every Cloud Run subdomain mapping resolves to the same anycast target, so
# the CNAME value is the well-known ghs.googlehosted.com rather than a value
# read back from the mapping (which keeps apply a single, order-stable pass).

data "cloudflare_zone" "zone" {
  count = var.manage_dns ? 1 : 0
  name  = var.cloudflare_zone_name
}

resource "cloudflare_record" "console" {
  count = var.manage_dns ? 1 : 0

  zone_id = data.cloudflare_zone.zone[0].id
  name    = local.dns_record_name
  type    = "CNAME"
  content = "ghs.googlehosted.com"
  proxied = false
  ttl     = 300
  comment = "Agent Tasker operator console → Cloud Run (managed by Terraform)"

  depends_on = [google_cloud_run_domain_mapping.console]
}

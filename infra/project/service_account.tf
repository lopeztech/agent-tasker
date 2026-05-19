# Coordinator service account. Per-agent SAs live in each agent's own
# Terraform root, not here — agents must be independent stacks (CLAUDE.md
# § Per-cloud agent implementation).
resource "google_service_account" "coordinator" {
  account_id   = "coordinator-${var.env}"
  display_name = "${var.project} coordinator (${var.env})"
  description  = "Coordinator service identity. Signs JWTs to agents; reads/writes the Firestore ledger; invokes agent Cloud Run services."

  depends_on = [google_project_service.required]
}

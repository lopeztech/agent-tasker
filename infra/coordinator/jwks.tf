# JWKS hosting for coordinator-minted task JWTs. Each agent's verifier
# fetches https://storage.googleapis.com/{bucket}/jwks.json, caches it, and
# verifies tokens against whichever key matches the `kid` header.
#
# Phase 1 keeps this on a public GCS bucket — no LB, no Cloud CDN, no custom
# domain. GCP fronts the bucket with its own HTTPS, signed by Google's cert.
# Justification:
#
#   - JWKS docs are public by definition; nothing here is sensitive.
#   - Both Phase 1 agents share a GCP project with the coordinator, so
#     intra-cloud egress is free and cross-cloud caching tuning isn't yet
#     load-bearing.
#   - One Terraform resource instead of ~six (backend bucket, URL map, HTTPS
#     proxy, forwarding rule, managed SSL cert, DNS record).
#
# Promote to LB + Cloud CDN + custom domain when the AWS/Nova or Azure/GPT
# agents land (Phase 2/3) and edge caching for cross-cloud verifiers starts
# to matter. The bucket itself stays as the origin; only the front door
# changes.

resource "google_storage_bucket" "jwks" {
  project = var.project_id

  # GCP bucket names are globally unique; include the project_id so dev/prod
  # never collide.
  name     = "${local.name_prefix}-jwks-${var.project_id}"
  location = var.jwks_bucket_location

  uniform_bucket_level_access = true
  public_access_prevention    = "inherited"

  # Versioning gives us a rollback path if a bad JWKS is published during
  # key rotation. The lifecycle rule bounds object-version retention so we
  # don't accumulate forever — JWKS docs are tiny but discipline matters.
  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 10
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  # See firestore.tf for the deletion_policy/delete_protection reasoning. Same
  # pattern: env-aware GCP-side protection plus a Terraform-side ABANDON so
  # accidental destroy doesn't nuke published keys.
  force_destroy = !var.jwks_delete_protection
}

# Anonymous read on objects — agents need to fetch jwks.json without any auth
# token (chicken-and-egg: the JWKS is what they'd use to verify auth).
# Restricted to objectViewer (read), not legacy objectReader (list).
resource "google_storage_bucket_iam_member" "jwks_public_read" {
  bucket = google_storage_bucket.jwks.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"

  depends_on = [google_project_organization_policy.allow_public_iam]
}

# The JWKS document itself is published by the coordinator at runtime (see
# follow-up PR — the publish helper lives in coordinator/src/jwks/ and runs
# on key generation / rotation). Terraform deliberately doesn't manage the
# object contents — its lifetime is operational, not declarative.
#
# Rotation flow (operator + code together):
#   1. Generate the incoming key. Publish a JWKS containing BOTH old + new
#      public keys.
#   2. Wait at least max(token TTL, JWKS cache TTL) so every in-flight token
#      can verify under whichever key signed it.
#   3. Flip the coordinator's active signing key to the new one.
#   4. Publish a JWKS containing only the new public key.

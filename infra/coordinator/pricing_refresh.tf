# Daily pricing-refresh Cloud Function + Cloud Scheduler trigger.
#
# Source today is a placeholder (functions/pricing-refresh/index.js) that
# logs and returns "stub". Real handler lands with #38 — Cloud Billing
# Catalog parsing + Firestore /pricing writes. The Terraform shape is
# unchanged when the source is swapped: only the archive_file picks up
# new bytes and triggers a redeploy via the hashed object name.
#
# Flow:
#   Cloud Scheduler --(OIDC)--> CF2 HTTP URL --> refreshPricing()
#   refreshPricing() reads Cloud Billing Catalog, writes Firestore docs.
#
# Both runtime and scheduler get dedicated SAs (separate from the
# coordinator runtime SA). The runtime SA writes Firestore; the
# scheduler SA holds the invoker permission on the function. Neither
# can do the other's job.

# Source bucket for function zips. Lifecycle keeps only the most recent
# 10 archived versions — function deploys are infrequent (~weekly when
# Tier 5 lands) but a stale zip is cheap to keep around for one-step
# rollback.
resource "google_storage_bucket" "functions_source" {
  project = var.project_id

  name     = "${local.name_prefix}-functions-source-${var.project_id}"
  location = var.region

  uniform_bucket_level_access = true

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

  force_destroy = !var.pricing_refresh_delete_protection
}

# Zip the placeholder source. output_md5 is part of the bucket object
# name so any change to the source forces a new upload + function redeploy.
data "archive_file" "pricing_refresh_source" {
  type        = "zip"
  source_dir  = "${path.module}/functions/pricing-refresh"
  output_path = "${path.module}/functions/.dist/pricing-refresh.zip"
}

resource "google_storage_bucket_object" "pricing_refresh_source" {
  name   = "pricing-refresh-${data.archive_file.pricing_refresh_source.output_md5}.zip"
  bucket = google_storage_bucket.functions_source.name
  source = data.archive_file.pricing_refresh_source.output_path
}

# Runtime SA — Firestore writer (for the /pricing collection), Cloud
# Billing Catalog reader, plus log writer.
resource "google_service_account" "pricing_refresh_runtime" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-pricing-refresh"
  display_name = "Pricing-refresh function runtime SA"
  description  = "Identity for the daily pricing-refresh Cloud Function — writes Firestore /pricing"
}

resource "google_project_iam_member" "pricing_refresh_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.pricing_refresh_runtime.email}"
}

resource "google_project_iam_member" "pricing_refresh_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.pricing_refresh_runtime.email}"
}

resource "google_project_iam_member" "pricing_refresh_billing_catalog" {
  project = var.project_id
  role    = "roles/billing.viewer"
  member  = "serviceAccount:${google_service_account.pricing_refresh_runtime.email}"
}

# Scheduler SA — holds run.invoker on the function and nothing else.
# Kept separate from the runtime SA so a compromised scheduler config
# can't write Firestore.
resource "google_service_account" "pricing_refresh_scheduler" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-pricing-sched"
  display_name = "Pricing-refresh scheduler SA"
  description  = "Identity Cloud Scheduler assumes when invoking the pricing-refresh function"
}

resource "google_cloudfunctions2_function" "pricing_refresh" {
  project  = var.project_id
  location = var.region
  name     = "${local.name_prefix}-pricing-refresh"

  build_config {
    runtime     = "nodejs22"
    entry_point = "refreshPricing"
    source {
      storage_source {
        bucket = google_storage_bucket.functions_source.name
        object = google_storage_bucket_object.pricing_refresh_source.name
      }
    }
  }

  service_config {
    service_account_email = google_service_account.pricing_refresh_runtime.email

    available_memory   = "256Mi"
    timeout_seconds    = 540 # 9 min — vendor APIs can be slow during burst
    max_instance_count = 1   # one daily run; no concurrency benefit
    min_instance_count = 0   # scale to zero between runs

    # Function URL is reachable only by callers that hold run.invoker IAM,
    # so even with all-traffic ingress, only the scheduler SA can invoke.
    # Keep ingress all so we can curl-invoke for ad-hoc smoke testing
    # using gcloud-minted OIDC tokens. Tighten to internal-only if a
    # follow-up requires it.
    ingress_settings = "ALLOW_ALL"

    environment_variables = {
      GCP_PROJECT_ID = var.project_id
    }
  }

  depends_on = [
    google_project_iam_member.pricing_refresh_billing_catalog,
    google_project_iam_member.pricing_refresh_firestore,
    google_project_iam_member.pricing_refresh_logs,
  ]
}

# Scheduler SA gets invoker on the underlying Cloud Run service that
# backs the gen-2 function. (gen-2 functions ARE Cloud Run services
# under the hood; the cloudfunctions.invoker role is gen-1 only.)
resource "google_cloud_run_v2_service_iam_member" "pricing_refresh_scheduler_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.pricing_refresh.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.pricing_refresh_scheduler.email}"
}

resource "google_cloud_scheduler_job" "pricing_refresh" {
  project = var.project_id
  region  = var.region
  name    = "${local.name_prefix}-pricing-refresh"

  schedule  = var.pricing_refresh_schedule
  time_zone = "Etc/UTC"

  http_target {
    uri         = google_cloudfunctions2_function.pricing_refresh.service_config[0].uri
    http_method = "POST"

    oidc_token {
      service_account_email = google_service_account.pricing_refresh_scheduler.email
      # audience must match the function URL for Cloud Run to accept it.
      audience = google_cloudfunctions2_function.pricing_refresh.service_config[0].uri
    }
  }

  retry_config {
    retry_count          = 1
    max_retry_duration   = "600s"
    min_backoff_duration = "60s"
    max_backoff_duration = "300s"
    max_doublings        = 2
  }
}

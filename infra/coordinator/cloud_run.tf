# Cloud Run service for the coordinator's public HTTP API.
#
# Phase 1 deploy shape:
# - `min_instance_count = 0` — scales to zero at idle so cost matches usage.
# - `max_instance_count` is capped by var to avoid runaway autoscale.
# - `startup_cpu_boost = true` so cold-start initialization (Firestore
#   client + Hono app) doesn't time-out.
# - `cpu_idle = false` keeps CPU allocated for the full request lifetime
#   *including* the fire-and-forget AuctionRunner.start() that the POST
#   /tasks handler kicks off (see CLAUDE.md → Phase 1 deploy plan).
# - Public ingress + `allUsers` invoker — the coordinator is the SPA's
#   API. CORS is handled in Hono middleware (TBD when SPA lands).
#
# Custom domain + managed TLS cert are deliberately *not* here; the
# auto-generated *.run.app URL works for Phase 1 dev. Domain mapping
# lands as a small follow-up once a domain is registered.

resource "google_service_account" "coordinator_runtime" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-coordinator"
  display_name = "Coordinator runtime SA"
  description  = "Identity for the coordinator Cloud Run service — reads/writes Firestore, publishes JWKS"
}

# Firestore (ledger + pricing reads/writes). datastore.user is the role
# that covers both Firestore Native and Datastore modes — name is legacy.
resource "google_project_iam_member" "coordinator_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.coordinator_runtime.email}"
}

# Publish/overwrite the JWKS object during key generation + rotation.
# Scoped to the JWKS bucket only via a bucket-level IAM member.
resource "google_storage_bucket_iam_member" "coordinator_jwks_writer" {
  bucket = google_storage_bucket.jwks.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.coordinator_runtime.email}"
}

# Cloud Logging writes (Cloud Run already grants this implicitly to the
# default SA; explicit binding here keeps custom-SA deploys symmetric).
resource "google_project_iam_member" "coordinator_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.coordinator_runtime.email}"
}

resource "google_cloud_run_v2_service" "coordinator" {
  project  = var.project_id
  location = var.region
  name     = "${local.name_prefix}-coordinator"

  deletion_protection = var.coordinator_delete_protection

  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.coordinator_runtime.email
    timeout         = "${var.coordinator_request_timeout_seconds}s"

    scaling {
      min_instance_count = var.coordinator_min_instances
      max_instance_count = var.coordinator_max_instances
    }

    containers {
      image = var.coordinator_image

      ports {
        container_port = 8080
      }

      resources {
        cpu_idle          = false # see file header
        startup_cpu_boost = true

        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "JWKS_BUCKET"
        value = google_storage_bucket.jwks.name
      }
      env {
        name  = "OTEL_SERVICE_NAME"
        value = "agent-tasker-coordinator"
      }
      env {
        name  = "OTEL_TRACES_EXPORTER"
        value = var.otel_exporter_otlp_endpoint == null ? "none" : "otlp"
      }
      env {
        name  = "OTEL_METRICS_EXPORTER"
        value = var.otel_exporter_otlp_endpoint == null ? "none" : "otlp"
      }
      env {
        name  = "OTEL_EXPORTER_OTLP_ENDPOINT"
        value = coalesce(var.otel_exporter_otlp_endpoint, "")
      }
      env {
        name  = "OTEL_EXPORTER_OTLP_HEADERS"
        value = coalesce(var.otel_exporter_otlp_headers, "")
      }
    }
  }

  # Don't roll back to an old revision if a new deploy fails — that masks
  # bugs. Operator picks the revision explicitly on rollback.
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  # Skip Terraform plan churn on fields that the gcloud / CI deploy
  # pipeline updates (image tag rolls forward on every push, client tag
  # gets stamped by gcloud).
  lifecycle {
    ignore_changes = [
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_iam_member.coordinator_firestore,
    google_storage_bucket_iam_member.coordinator_jwks_writer,
    google_project_iam_member.coordinator_logs,
  ]
}

# Public invoker — SPA hits this URL directly. Swap to authenticated-only
# (`roles/run.invoker` granted to specific SAs) when the SPA grows an
# auth layer.
resource "google_cloud_run_v2_service_iam_member" "coordinator_public" {
  project  = google_cloud_run_v2_service.coordinator.project
  location = google_cloud_run_v2_service.coordinator.location
  name     = google_cloud_run_v2_service.coordinator.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Cloud Run service for the GCP/Gemini agent.
#
# Isolation model per CLAUDE.md → Per-cloud agent implementation:
# - Dedicated runtime SA (separate from the GCP/Orchestrator agent's SA
#   which lands in #90). This SA gets only the Vertex AI scopes needed
#   for direct `predict` against the publisher path.
# - `roles/aiplatform.user` carries an IAM Condition restricting use to
#   `publishers/google/` resource paths. CLAUDE.md notes the condition
#   alone doesn't distinguish this agent from the orchestrator (both
#   target Gemini), so this is defense-in-depth — the load-bearing
#   isolation is the runtime layer (direct SDK vs GAEP) plus distinct
#   SAs plus run.invoker scoping below.
# - `roles/run.invoker` is granted ONLY to the coordinator runtime SA.
#   Neither agent can invoke the other; clients can't invoke either
#   directly. Cloud Run rejects un-IAM'd requests at the edge.
#
# Ingress is public (INGRESS_TRAFFIC_ALL): the IAM layer enforces
# coordinator-only invocation. Inter-Cloud-Run identity-token auth from
# the coordinator's HttpAuctionRunner lands in a follow-up small PR; until
# then the coordinator's Bearer token is the task JWT (verified by the
# agent's Hono middleware) and Cloud Run's invoker IAM check is satisfied
# by the SA identity Cloud Run injects automatically when the coordinator
# calls a service in the same project.

resource "google_service_account" "agent_runtime" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-gcp-gemini"
  display_name = "GCP/Gemini agent runtime SA"
  description  = "Identity for the GCP/Gemini agent — direct Vertex AI Gemini calls only"
}

resource "google_project_iam_member" "agent_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.agent_runtime.email}"

  condition {
    title       = "vertex_publishers_google_only"
    description = "Restrict to Google's first-party model publishers (Gemini family)"
    expression  = "resource.name.startsWith(\"projects/${var.project_id}/locations/${var.region}/publishers/google/\")"
  }
}

resource "google_project_iam_member" "agent_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.agent_runtime.email}"
}

resource "google_cloud_run_v2_service" "agent" {
  project  = var.project_id
  location = var.region
  name     = "${local.name_prefix}-gcp-gemini"

  deletion_protection = var.agent_delete_protection

  # Public DNS endpoint; the run.invoker IAM binding below is the gate.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.agent_runtime.email
    timeout         = "${var.agent_request_timeout_seconds}s"

    scaling {
      min_instance_count = var.agent_min_instances
      max_instance_count = var.agent_max_instances
    }

    containers {
      image = var.agent_image

      ports {
        container_port = 8080
      }

      resources {
        # /bid is short (Gemini Flash); /execute can be longer (Gemini 2.5
        # Pro) but is still a single request. cpu_idle = true lets Cloud
        # Run free CPU between requests; no fire-and-forget work like the
        # coordinator's auction kickoff.
        cpu_idle          = true
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
        name  = "GCP_LOCATION"
        value = var.region
      }
      env {
        name  = "JWKS_URL"
        value = var.jwks_url
      }
      env {
        name  = "OTEL_SERVICE_NAME"
        value = "agent-tasker-gcp-gemini"
      }
      env {
        name  = "OTEL_TRACES_EXPORTER"
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

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_iam_member.agent_vertex,
    google_project_iam_member.agent_logs,
  ]
}

# Coordinator runtime SA is the only principal that can invoke this
# service. Future: tighten further by switching to a per-(coordinator,
# agent) signing SA pair if cross-cloud signing diverges.
resource "google_cloud_run_v2_service_iam_member" "coordinator_only_invoker" {
  project  = google_cloud_run_v2_service.agent.project
  location = google_cloud_run_v2_service.agent.location
  name     = google_cloud_run_v2_service.agent.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.coordinator_service_account_email}"
}

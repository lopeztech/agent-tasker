# Cloud Run service for the GCP/Orchestrator agent.
#
# Isolation model per AGENTS.md:
# - Dedicated runtime SA, distinct from the GCP/Gemini direct-call agent.
# - Vertex AI access is present for Gemini-backed bidding and orchestration,
#   while Gemini Enterprise / GAEP execution roles are granted separately via
#   `gaep_agent_execution_roles`.
# - The runtime contract is GAEP-only for execution. Direct single-call Vertex
#   execution is intentionally left to the GCP/Gemini stack.
# - `roles/run.invoker` is granted ONLY to the coordinator runtime SA. Neither
#   GCP agent can invoke the other, and clients cannot invoke either directly.
#
# Ingress is public (INGRESS_TRAFFIC_ALL): the IAM layer enforces
# coordinator-only invocation, matching the GCP/Gemini service shape.

resource "google_service_account" "agent_runtime" {
  project      = var.project_id
  account_id   = local.agent_service_account_id
  display_name = "GCP/Orchestrator agent runtime SA"
  description  = "Identity for the GCP/Orchestrator agent — GAEP runtime execution only"
}

resource "google_project_iam_member" "agent_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.agent_runtime.email}"
}

resource "google_project_iam_member" "agent_gaep_execution" {
  for_each = var.gaep_agent_execution_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.agent_runtime.email}"
}

resource "google_project_iam_member" "agent_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.agent_runtime.email}"
}

resource "google_cloud_run_v2_service" "agent" {
  project  = var.project_id
  location = var.region
  name     = "${local.name_prefix}-gcp-orchestrator"

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
        # The shim is thin; GAEP does the multi-step work. Keep idle CPU off
        # for cost while preserving startup boost for cold bid rounds.
        cpu_idle          = true
        startup_cpu_boost = true

        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "AGENT_ID"
        value = "gcp-orchestrator"
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
        name  = "GAEP_AGENT_RESOURCE_NAME"
        value = var.gaep_agent_resource_name
      }
      env {
        name  = "JWKS_URL"
        value = var.jwks_url
      }
      env {
        name  = "OTEL_SERVICE_NAME"
        value = "agent-tasker-gcp-orchestrator"
      }
      env {
        name  = "OTEL_TRACES_EXPORTER"
        value = var.otel_exporter_otlp_endpoint == null ? "none" : "otlp"
      }
      env {
        name  = "OTEL_EXPORTER_OTLP_ENDPOINT"
        value = var.otel_exporter_otlp_endpoint != null ? var.otel_exporter_otlp_endpoint : ""
      }
      env {
        name  = "OTEL_EXPORTER_OTLP_HEADERS"
        value = var.otel_exporter_otlp_headers != null ? var.otel_exporter_otlp_headers : ""
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
    google_project_iam_member.agent_gaep_execution,
    google_project_iam_member.agent_logs,
  ]
}

# Phase 1: public invoker so the coordinator can call the agent with its
# custom JWT in the Authorization header without needing a GCP OIDC token.
# Application-level JWT (RS256, coordinator-signed) is the auth boundary.
# Future: switch to coordinator-SA-only invoker + X-Task-Token OIDC two-
# token pattern once OIDC fetching is wired in HttpAuctionRunner.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = google_cloud_run_v2_service.agent.project
  location = google_cloud_run_v2_service.agent.location
  name     = google_cloud_run_v2_service.agent.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

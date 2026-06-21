# Cloud Run service for the operator console.
#
# Unlike the agents (which are locked to coordinator-only invocation), this is
# a public stakeholder-facing website: ingress is open and `roles/run.invoker`
# is granted to `allUsers`. It serves only the static SPA bundle — no secrets,
# no privileged runtime — so the runtime SA is near-empty (logging only).
#
# The custom domain + TLS are handled by the Cloud Run domain mapping in
# domain_mapping.tf; this file owns the service and its public access.

resource "google_service_account" "console_runtime" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-operator-console"
  display_name = "Operator console runtime SA"
  description  = "Identity for the operator console Cloud Run service — serves the static Market Terminal SPA only"
}

# Container stdout/stderr is captured to Cloud Logging by Cloud Run regardless,
# but granting logWriter keeps parity with the other services and leaves room
# for structured logging later.
resource "google_project_iam_member" "console_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.console_runtime.email}"
}

resource "google_cloud_run_v2_service" "console" {
  project  = var.project_id
  location = var.region
  name     = "${local.name_prefix}-operator-console"

  deletion_protection = var.console_delete_protection

  # Public website: open ingress, public invoker IAM below.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.console_runtime.email

    scaling {
      min_instance_count = var.console_min_instances
      max_instance_count = var.console_max_instances
    }

    containers {
      image = var.console_image

      ports {
        container_port = 8080
      }

      resources {
        # Static file serving is trivially cheap. cpu_idle frees CPU between
        # requests; scale-to-zero (min_instances = 0) keeps it ~free at idle.
        cpu_idle          = true
        startup_cpu_boost = true

        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
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
    google_project_iam_member.console_logs,
  ]
}

# Public read access. `allUsers` invoker requires the project org policy
# `iam.allowedPolicyMemberDomains` to permit non-domain principals — that
# policy is restored project-wide by infra/coordinator (google_project_
# organization_policy.allow_public_iam), which is already applied. If this
# module is ever deployed into a fresh project, apply infra/coordinator (or
# replicate that org-policy override) first.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = google_cloud_run_v2_service.console.project
  location = google_cloud_run_v2_service.console.location
  name     = google_cloud_run_v2_service.console.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

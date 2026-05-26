resource "google_bigquery_dataset" "ledger_export" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  project    = var.project_id
  dataset_id = var.ledger_bigquery_dataset_id
  location   = var.ledger_bigquery_location

  description                 = "Analytical export of the agent-tasker Firestore ledger"
  delete_contents_on_destroy  = false
  default_table_expiration_ms = var.ledger_bigquery_table_expiration_days == null ? null : var.ledger_bigquery_table_expiration_days * 24 * 60 * 60 * 1000
}

resource "google_bigquery_table" "ledger_tasks" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  project    = var.project_id
  dataset_id = google_bigquery_dataset.ledger_export[0].dataset_id
  table_id   = "ledger_tasks"

  deletion_protection = var.ledger_bigquery_table_delete_protection

  schema = jsonencode([
    { name = "task_id", type = "STRING", mode = "REQUIRED" },
    { name = "status", type = "STRING", mode = "REQUIRED" },
    { name = "created_at", type = "TIMESTAMP" },
    { name = "updated_at", type = "TIMESTAMP" },
    { name = "winner_agent_id", type = "STRING" },
    { name = "auction_price_usd", type = "FLOAT" },
    { name = "winning_bid_usd", type = "FLOAT" },
    { name = "prompt", type = "STRING" },
    { name = "min_tier", type = "STRING" },
    { name = "output", type = "STRING" },
    { name = "actual_input_tokens", type = "INTEGER" },
    { name = "actual_output_tokens", type = "INTEGER" },
    { name = "spec_json", type = "JSON" },
    { name = "result_json", type = "JSON" },
  ])
}

resource "google_bigquery_table" "ledger_bids" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  project    = var.project_id
  dataset_id = google_bigquery_dataset.ledger_export[0].dataset_id
  table_id   = "ledger_bids"

  deletion_protection = var.ledger_bigquery_table_delete_protection

  schema = jsonencode([
    { name = "task_id", type = "STRING", mode = "REQUIRED" },
    { name = "agent_id", type = "STRING", mode = "REQUIRED" },
    { name = "timestamp", type = "TIMESTAMP" },
    { name = "response_kind", type = "STRING" },
    { name = "tier", type = "STRING" },
    { name = "model_family", type = "STRING" },
    { name = "model_id", type = "STRING" },
    { name = "bid_usd", type = "FLOAT" },
    { name = "est_input_tokens", type = "INTEGER" },
    { name = "est_output_tokens", type = "INTEGER" },
    { name = "no_bid_reason", type = "STRING" },
    { name = "response_json", type = "JSON" },
    { name = "pricing_snapshot_json", type = "JSON" },
  ])
}

resource "google_bigquery_table" "ledger_results" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  project    = var.project_id
  dataset_id = google_bigquery_dataset.ledger_export[0].dataset_id
  table_id   = "ledger_results"

  deletion_protection = var.ledger_bigquery_table_delete_protection

  schema = jsonencode([
    { name = "task_id", type = "STRING", mode = "REQUIRED" },
    { name = "agent_id", type = "STRING", mode = "REQUIRED" },
    { name = "timestamp", type = "TIMESTAMP" },
    { name = "actual_input_tokens", type = "INTEGER" },
    { name = "actual_output_tokens", type = "INTEGER" },
    { name = "actual_step_count", type = "INTEGER" },
    { name = "actual_tool_call_count", type = "INTEGER" },
    { name = "result_json", type = "JSON" },
    { name = "step_trace_json", type = "JSON" },
  ])
}

data "archive_file" "ledger_export_source" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  type        = "zip"
  source_dir  = "${path.module}/functions/ledger-export"
  output_path = "${path.module}/functions/.dist/ledger-export.zip"
}

resource "google_storage_bucket_object" "ledger_export_source" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  name   = "ledger-export-${data.archive_file.ledger_export_source[0].output_md5}.zip"
  bucket = google_storage_bucket.functions_source.name
  source = data.archive_file.ledger_export_source[0].output_path
}

resource "google_service_account" "ledger_export_runtime" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  project      = var.project_id
  account_id   = "${local.name_prefix}-ledger-export"
  display_name = "Ledger-export function runtime SA"
  description  = "Identity for scheduled Firestore ledger exports to BigQuery"
}

resource "google_project_iam_member" "ledger_export_firestore" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  project = var.project_id
  role    = "roles/datastore.viewer"
  member  = "serviceAccount:${google_service_account.ledger_export_runtime[0].email}"
}

resource "google_project_iam_member" "ledger_export_bigquery_job_user" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.ledger_export_runtime[0].email}"
}

resource "google_bigquery_dataset_iam_member" "ledger_export_bigquery_writer" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  project    = var.project_id
  dataset_id = google_bigquery_dataset.ledger_export[0].dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.ledger_export_runtime[0].email}"
}

resource "google_project_iam_member" "ledger_export_logs" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.ledger_export_runtime[0].email}"
}

resource "google_service_account" "ledger_export_scheduler" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  project      = var.project_id
  account_id   = "${local.name_prefix}-ledger-sched"
  display_name = "Ledger-export scheduler SA"
  description  = "Identity Cloud Scheduler assumes when invoking the ledger-export function"
}

resource "google_cloudfunctions2_function" "ledger_export" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = "${local.name_prefix}-ledger-export"

  build_config {
    runtime     = "nodejs22"
    entry_point = "exportLedger"
    source {
      storage_source {
        bucket = google_storage_bucket.functions_source.name
        object = google_storage_bucket_object.ledger_export_source[0].name
      }
    }
  }

  service_config {
    service_account_email = google_service_account.ledger_export_runtime[0].email

    available_memory   = "512Mi"
    timeout_seconds    = 540
    max_instance_count = 1
    min_instance_count = 0
    ingress_settings   = "ALLOW_ALL"

    environment_variables = {
      GCP_PROJECT_ID        = var.project_id
      BIGQUERY_DATASET      = google_bigquery_dataset.ledger_export[0].dataset_id
      EXPORT_LOOKBACK_HOURS = tostring(var.ledger_bigquery_export_lookback_hours)
    }
  }

  depends_on = [
    google_bigquery_dataset_iam_member.ledger_export_bigquery_writer,
    google_project_iam_member.ledger_export_bigquery_job_user,
    google_project_iam_member.ledger_export_firestore,
    google_project_iam_member.ledger_export_logs,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "ledger_export_scheduler_invoker" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.ledger_export[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.ledger_export_scheduler[0].email}"
}

resource "google_cloud_scheduler_job" "ledger_export" {
  count = var.ledger_bigquery_export_enabled ? 1 : 0

  project = var.project_id
  region  = var.region
  name    = "${local.name_prefix}-ledger-export"

  schedule  = var.ledger_bigquery_export_schedule
  time_zone = "Etc/UTC"

  http_target {
    uri         = google_cloudfunctions2_function.ledger_export[0].service_config[0].uri
    http_method = "POST"

    oidc_token {
      service_account_email = google_service_account.ledger_export_scheduler[0].email
      audience              = google_cloudfunctions2_function.ledger_export[0].service_config[0].uri
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

# Logs-based alerting for the daily pricing-refresh job. The function uses
# structured logs with `msg` values prefixed by `pricing-refresh:`; any ERROR
# there means the pricing snapshot path degraded to fallback, partial writes,
# or a full no-write failure.

resource "google_logging_metric" "pricing_refresh_errors" {
  project = var.project_id
  name    = "${local.name_prefix}-pricing-refresh-errors"

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="${google_cloudfunctions2_function.pricing_refresh.name}"
    jsonPayload.msg:"pricing-refresh:"
    (severity>=ERROR OR jsonPayload.severity="ERROR")
  EOT

  label_extractors = {
    message = "EXTRACT(jsonPayload.msg)"
  }

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Pricing refresh errors"

    labels {
      key         = "message"
      value_type  = "STRING"
      description = "Structured pricing-refresh log message."
    }
  }
}

resource "google_monitoring_alert_policy" "pricing_refresh_errors" {
  project      = var.project_id
  display_name = "${local.name_prefix} pricing-refresh errors"
  combiner     = "OR"
  enabled      = true

  notification_channels = var.pricing_refresh_alert_notification_channels

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      The daily pricing-refresh function emitted at least one ERROR log.

      Check Cloud Run / Cloud Functions logs for `${google_cloudfunctions2_function.pricing_refresh.name}` and verify the latest Firestore `pricing/{model_id}` documents still point at a fresh snapshot. Vendor fetch failures use fallback prices; write failures leave the affected model on last-known-good.
    EOT
  }

  conditions {
    display_name = "Pricing refresh emitted errors"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.pricing_refresh_errors.name}\" resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["metric.label.message"]
      }

      trigger {
        count = 1
      }
    }
  }
}

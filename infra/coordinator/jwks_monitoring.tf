# JWKS rotation health alerting. The coordinator publishes `jwks.json` to a
# public GCS bucket when keys are generated or rotated. This policy alerts if
# that object has not been updated recently enough to prove the publishing path
# still works.

resource "google_monitoring_alert_policy" "jwks_stale" {
  project      = var.project_id
  display_name = "${local.name_prefix} JWKS publish stale"
  combiner     = "OR"
  enabled      = true

  notification_channels = var.jwks_rotation_alert_notification_channels

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      `jwks.json` in bucket `${google_storage_bucket.jwks.name}` has not been updated in the last 32 days.

      Check the coordinator JWKS publish/rotation path before rotating signing keys. Agents cache the public key set and rely on this object to verify coordinator-signed task JWTs.
    EOT
  }

  conditions {
    display_name = "JWKS object update count is zero"

    condition_threshold {
      filter          = "metric.type=\"storage.googleapis.com/api/request_count\" resource.type=\"gcs_bucket\" resource.label.bucket_name=\"${google_storage_bucket.jwks.name}\" metric.label.method=\"storage.objects.update\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "0s"

      aggregations {
        alignment_period   = "2764800s" # 32 days
        per_series_aligner = "ALIGN_SUM"
      }

      trigger {
        count = 1
      }
    }
  }
}

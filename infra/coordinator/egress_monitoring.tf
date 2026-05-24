# Logs-based metric + Cloud Monitoring dashboard for coordinator-to-agent
# request egress. Phase 2's AWS leg is the first billable cross-cloud path;
# Phase 3 adds Azure to the same labels without another metric.

resource "google_logging_metric" "coordinator_agent_egress_bytes" {
  project = var.project_id
  name    = "${local.name_prefix}-agent-egress-bytes"

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="${google_cloud_run_v2_service.coordinator.name}"
    jsonPayload.event="coordinator.agent_egress_bytes"
  EOT

  value_extractor = "EXTRACT(jsonPayload.bytes_out)"

  label_extractors = {
    agent_id     = "EXTRACT(jsonPayload.agent_id)"
    cloud_leg    = "EXTRACT(jsonPayload.cloud_leg)"
    egress_class = "EXTRACT(jsonPayload.egress_class)"
    phase        = "EXTRACT(jsonPayload.phase)"
  }

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "By"
    display_name = "Coordinator agent egress bytes"

    labels {
      key         = "agent_id"
      value_type  = "STRING"
      description = "Agent endpoint receiving the coordinator request."
    }

    labels {
      key         = "cloud_leg"
      value_type  = "STRING"
      description = "Target cloud for the agent endpoint: gcp, aws, or azure."
    }

    labels {
      key         = "egress_class"
      value_type  = "STRING"
      description = "same_cloud for GCP-local agents, cross_cloud for AWS/Azure legs."
    }

    labels {
      key         = "phase"
      value_type  = "STRING"
      description = "Auction protocol phase that sent the request."
    }
  }
}

resource "google_monitoring_dashboard" "cross_cloud_egress" {
  project = var.project_id

  dashboard_json = jsonencode({
    displayName = "${local.name_prefix} cross-cloud egress"
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          xPos   = 0
          yPos   = 0
          width  = 12
          height = 4
          widget = {
            title = "Coordinator bytes out by cloud leg"
            xyChart = {
              dataSets = [
                {
                  plotType = "STACKED_AREA"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.coordinator_agent_egress_bytes.name}\" resource.type=\"cloud_run_revision\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_SUM"
                        crossSeriesReducer = "REDUCE_SUM"
                        groupByFields      = ["metric.label.cloud_leg"]
                      }
                    }
                  }
                }
              ]
              yAxis = {
                label = "bytes / min"
                scale = "LINEAR"
              }
            }
          }
        },
        {
          xPos   = 0
          yPos   = 4
          width  = 6
          height = 4
          widget = {
            title = "Billable cross-cloud bytes"
            xyChart = {
              dataSets = [
                {
                  plotType = "LINE"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.coordinator_agent_egress_bytes.name}\" resource.type=\"cloud_run_revision\" metric.label.egress_class=\"cross_cloud\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_SUM"
                        crossSeriesReducer = "REDUCE_SUM"
                      }
                    }
                  }
                }
              ]
              yAxis = {
                label = "bytes / min"
                scale = "LINEAR"
              }
            }
          }
        },
        {
          xPos   = 6
          yPos   = 4
          width  = 6
          height = 4
          widget = {
            title = "Coordinator bytes out by phase"
            xyChart = {
              dataSets = [
                {
                  plotType = "STACKED_BAR"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.coordinator_agent_egress_bytes.name}\" resource.type=\"cloud_run_revision\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_SUM"
                        crossSeriesReducer = "REDUCE_SUM"
                        groupByFields      = ["metric.label.phase"]
                      }
                    }
                  }
                }
              ]
              yAxis = {
                label = "bytes / min"
                scale = "LINEAR"
              }
            }
          }
        }
      ]
    }
  })
}

# Observability

OpenTelemetry tracing is wired into the coordinator and agent runtimes. The coordinator also exports market metrics for Grafana dashboards. Terraform keeps export disabled by default so development deployments do not try to send telemetry to a local OTLP collector.

To enable Grafana Cloud traces for a stack, set both variables for that Terraform module:

```hcl
otel_exporter_otlp_endpoint = "https://otlp-gateway-prod-us-central-0.grafana.net/otlp"
otel_exporter_otlp_headers  = "Authorization=Basic <base64 instance_id:token>"
```

Use the endpoint shown in the Grafana Cloud OTLP setup page for the account's region. The header value contains the Grafana Cloud instance ID and an access policy token with traces write scope.

When `otel_exporter_otlp_endpoint` is unset, Terraform sets `OTEL_TRACES_EXPORTER=none`. When it is set, Terraform adds:

- `OTEL_SERVICE_NAME`
- `OTEL_TRACES_EXPORTER=otlp`
- `OTEL_METRICS_EXPORTER=otlp` on the coordinator
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS` when provided

`otel_exporter_otlp_headers` is marked sensitive, but it is still stored in Terraform state. Keep state in encrypted, access-controlled backends and rotate the Grafana token if state access changes.

## Alerts

The coordinator Terraform creates a Cloud Monitoring policy for pricing-refresh ERROR logs. Set `pricing_refresh_alert_notification_channels` to Cloud Monitoring notification channel resource names to page on failures; leave it empty to create the policy without notifications while bootstrapping.

## Dashboards

Import dashboard JSON from `docs/grafana/dashboards/` into Grafana Cloud:

- `agent-win-rate.json` tracks bid counts, settled wins, and win rate per agent/tier from the coordinator OTLP metrics `agent_tasker_agent_bids` and `agent_tasker_agent_wins`.
- `agent-mape-drift.json` tracks MAPE, p95 absolute percentage error, and signed bid drift from coordinator OTLP metrics emitted when winning tasks settle.
- `bid-latency.json` tracks per-agent `/bid` latency and full adaptive bid-round latency p50/p95/p99.

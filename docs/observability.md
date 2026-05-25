# Observability

OpenTelemetry tracing is wired into the coordinator and agent runtimes. Terraform keeps export disabled by default so development deployments do not try to send spans to a local OTLP collector.

To enable Grafana Cloud traces for a stack, set both variables for that Terraform module:

```hcl
otel_exporter_otlp_endpoint = "https://otlp-gateway-prod-us-central-0.grafana.net/otlp"
otel_exporter_otlp_headers  = "Authorization=Basic <base64 instance_id:token>"
```

Use the endpoint shown in the Grafana Cloud OTLP setup page for the account's region. The header value contains the Grafana Cloud instance ID and an access policy token with traces write scope.

When `otel_exporter_otlp_endpoint` is unset, Terraform sets `OTEL_TRACES_EXPORTER=none`. When it is set, Terraform adds:

- `OTEL_SERVICE_NAME`
- `OTEL_TRACES_EXPORTER=otlp`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS` when provided

`otel_exporter_otlp_headers` is marked sensitive, but it is still stored in Terraform state. Keep state in encrypted, access-controlled backends and rotate the Grafana token if state access changes.

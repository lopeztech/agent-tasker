import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

export interface CoordinatorTelemetryOptions {
  env?: NodeJS.ProcessEnv;
}

export interface CoordinatorTelemetryHandle {
  shutdown(): Promise<void>;
}

export function startCoordinatorTelemetry(
  options: CoordinatorTelemetryOptions = {},
): CoordinatorTelemetryHandle | null {
  const env = options.env ?? process.env;
  if (env["OTEL_SDK_DISABLED"] === "true") return null;

  const sdk = new NodeSDK({
    serviceName: env["OTEL_SERVICE_NAME"] ?? "agent-tasker-coordinator",
    ...(env["OTEL_TRACES_EXPORTER"] === "none" ? {} : { traceExporter: new OTLPTraceExporter() }),
    ...(env["OTEL_METRICS_EXPORTER"] === "otlp"
      ? {
          metricReaders: [
            new PeriodicExportingMetricReader({
              exporter: new OTLPMetricExporter(),
            }),
          ],
        }
      : {}),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  try {
    sdk.start();
    return {
      shutdown: () => sdk.shutdown(),
    };
  } catch (err) {
    console.warn("coordinator OpenTelemetry startup failed", err);
    return null;
  }
}

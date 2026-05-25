import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";

export interface AgentTelemetryOptions {
  serviceName: string;
  env?: NodeJS.ProcessEnv;
}

export interface AgentTelemetryHandle {
  shutdown(): Promise<void>;
}

export function startAgentTelemetry(options: AgentTelemetryOptions): AgentTelemetryHandle | null {
  const env = options.env ?? process.env;
  if (env["OTEL_SDK_DISABLED"] === "true") return null;

  const sdk = new NodeSDK({
    serviceName: env["OTEL_SERVICE_NAME"] ?? options.serviceName,
    ...(env["OTEL_TRACES_EXPORTER"] === "none" ? {} : { traceExporter: new OTLPTraceExporter() }),
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
    console.warn(`${options.serviceName} OpenTelemetry startup failed`, err);
    return null;
  }
}

export async function withAgentSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return trace
    .getTracer("agent-tasker-agent")
    .startActiveSpan(name, { attributes }, async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        if (err instanceof Error) {
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        } else {
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        }
        throw err;
      } finally {
        span.end();
      }
    });
}

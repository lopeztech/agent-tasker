import { startAgentTelemetry, type AgentTelemetryHandle } from "@agent-tasker/agent";

export const AGENT_ID = "gcp-orchestrator";
export const TELEMETRY_SERVICE_NAME = `agent-tasker-${AGENT_ID}`;

export function startTelemetry(env?: NodeJS.ProcessEnv): AgentTelemetryHandle | null {
  return startAgentTelemetry({
    serviceName: TELEMETRY_SERVICE_NAME,
    ...(env ? { env } : {}),
  });
}

export * from "./app.js";
export * from "./bid/index.js";
export * from "./runtime.js";
export * from "./tools.js";

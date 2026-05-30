import { handle } from "hono/aws-lambda";
import { createRemoteJWKSet } from "jose";
import { createTaskTokenVerifier, startAgentTelemetry } from "@agent-tasker/agent";
import { FALLBACK_PRICING } from "@agent-tasker/protocol";
import { AGENT_ID } from "./bid/handler.js";
import { createApp } from "./app.js";
import { NovaBidEstimator, createBedrockNovaJsonClient } from "./bid/estimator.js";
import { createBedrockNovaTextClient } from "./execute/runner.js";

const jwksUrl = process.env["JWKS_URL"];
const bidModelId = process.env["AWS_NOVA_BID_MODEL_ID"] ?? "amazon.nova-micro-v1:0";
const execModelId = process.env["AWS_NOVA_EXEC_MODEL_ID"] ?? "amazon.nova-pro-v1:0";
// AWS_REGION is injected automatically by the Lambda runtime.
const region = process.env["AWS_REGION"] ?? "us-east-1";

if (!jwksUrl) {
  throw new Error("JWKS_URL env var is required");
}

void startAgentTelemetry({ serviceName: `agent-tasker-${AGENT_ID}` });

const verifier = createTaskTokenVerifier({
  getKey: createRemoteJWKSet(new URL(jwksUrl), { cacheMaxAge: 10 * 60_000 }),
  expectedAudience: AGENT_ID,
});

const pricing = FALLBACK_PRICING["amazon.nova-pro"];
if (!pricing) {
  throw new Error("missing FALLBACK_PRICING entry for amazon.nova-pro");
}

const estimator = new NovaBidEstimator(
  createBedrockNovaJsonClient({ region, modelId: bidModelId }),
);

const client = createBedrockNovaTextClient({ region, modelId: execModelId });

const app = createApp({ verifier, estimator, client, pricing });

export const handler = handle(app);

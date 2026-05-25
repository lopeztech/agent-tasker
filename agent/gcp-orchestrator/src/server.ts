import { serve } from "@hono/node-server";
import { createRemoteJWKSet } from "jose";
import { createTaskTokenVerifier } from "@agent-tasker/agent";
import { FALLBACK_PRICING } from "@agent-tasker/protocol";
import { AGENT_ID, startTelemetry } from "./index.js";
import { createApp } from "./app.js";
import { OrchestratorBidEstimator, createVertexJsonClient } from "./bid/estimator.js";
import { createGaepRuntimeClient } from "./runtime.js";

const telemetry = startTelemetry();
const port = Number(process.env["PORT"] ?? 8080);
const projectId = process.env["GCP_PROJECT_ID"];
const location = process.env["GCP_LOCATION"] ?? "us-central1";
const jwksUrl = process.env["JWKS_URL"];
const gaepAgentResourceName = process.env["GAEP_AGENT_RESOURCE_NAME"];
const bidModel = process.env["BID_MODEL"] ?? "gemini-2.5-flash";

if (!projectId || !jwksUrl) {
  console.error("GCP_PROJECT_ID and JWKS_URL env vars are required");
  process.exit(1);
}

const verifier = createTaskTokenVerifier({
  getKey: createRemoteJWKSet(new URL(jwksUrl), { cacheMaxAge: 10 * 60_000 }),
  expectedAudience: AGENT_ID,
});

const pricing = FALLBACK_PRICING["gemini-2-5-pro"];
if (!pricing) {
  console.error("missing FALLBACK_PRICING entry for gemini-2-5-pro");
  process.exit(1);
}

const estimator = new OrchestratorBidEstimator(
  createVertexJsonClient({ project: projectId, location, model: bidModel }),
);

const runtime = createGaepRuntimeClient({ agentResourceName: gaepAgentResourceName });
const app = createApp({ verifier, estimator, pricing, runtime });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`${AGENT_ID} agent listening on :${info.port}`);
});

process.once("SIGTERM", () => {
  void telemetry?.shutdown().finally(() => {
    process.exit(0);
  });
});

import { serve } from "@hono/node-server";
import { createRemoteJWKSet } from "jose";
import { FALLBACK_PRICING } from "@agent-tasker/protocol";
import { createTaskTokenVerifier } from "@agent-tasker/agent";
import { createApp } from "./app.js";
import { VertexBidEstimator, createVertexJsonClient } from "./bid/estimator.js";
import { createVertexTextClient } from "./execute/runner.js";

// Cloud Run entrypoint. Reads config from env vars set in
// infra/agent-gcp-gemini Terraform, then wires Vertex AI clients +
// the JWT verifier and serves the Hono app on $PORT.

const port = Number(process.env["PORT"] ?? 8080);
const projectId = process.env["GCP_PROJECT_ID"];
const location = process.env["GCP_LOCATION"] ?? "us-central1";
const jwksUrl = process.env["JWKS_URL"];
const bidModel = process.env["BID_MODEL"] ?? "gemini-2.5-flash";
const executeModel = process.env["EXECUTE_MODEL"] ?? "gemini-2.5-pro";

if (!projectId || !jwksUrl) {
  console.error("GCP_PROJECT_ID and JWKS_URL env vars are required");
  process.exit(1);
}

const verifier = createTaskTokenVerifier({
  getKey: createRemoteJWKSet(new URL(jwksUrl), { cacheMaxAge: 10 * 60_000 }),
  expectedAudience: "gcp-gemini",
});

const estimator = new VertexBidEstimator(
  createVertexJsonClient({ project: projectId, location, model: bidModel }),
);

const client = createVertexTextClient({
  project: projectId,
  location,
  model: executeModel,
});

const pricing = FALLBACK_PRICING["gemini-2-5-pro"];
if (!pricing) {
  console.error("missing FALLBACK_PRICING entry for gemini-2-5-pro");
  process.exit(1);
}

const app = createApp({ verifier, estimator, client, pricing });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `gcp-gemini agent listening on :${info.port} (project ${projectId}, location ${location})`,
  );
});

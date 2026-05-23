import { serve } from "@hono/node-server";
import { createRemoteJWKSet } from "jose";
import { createTaskTokenVerifier } from "@agent-tasker/agent";
import { FALLBACK_PRICING } from "@agent-tasker/protocol";
import { AGENT_ID } from "./index.js";
import { createApp } from "./app.js";
import { AzureOpenAiBidEstimator, createAzureOpenAiJsonClient } from "./bid/estimator.js";

const port = Number(process.env["PORT"] ?? 8080);
const jwksUrl = process.env["JWKS_URL"];
const azureOpenAiEndpoint = process.env["AZURE_OPENAI_ENDPOINT"];
const azureOpenAiApiKey = process.env["AZURE_OPENAI_API_KEY"];
const bidDeployment = process.env["AZURE_OPENAI_BID_DEPLOYMENT"] ?? "gpt-5-mini";
const apiVersion = process.env["AZURE_OPENAI_API_VERSION"] ?? "2025-04-01-preview";

if (!jwksUrl || !azureOpenAiEndpoint || !azureOpenAiApiKey) {
  console.error("JWKS_URL, AZURE_OPENAI_ENDPOINT, and AZURE_OPENAI_API_KEY env vars are required");
  process.exit(1);
}

const verifier = createTaskTokenVerifier({
  getKey: createRemoteJWKSet(new URL(jwksUrl), { cacheMaxAge: 10 * 60_000 }),
  expectedAudience: AGENT_ID,
});

const pricing = FALLBACK_PRICING["gpt-5"];
if (!pricing) {
  console.error("missing FALLBACK_PRICING entry for gpt-5");
  process.exit(1);
}

const estimator = new AzureOpenAiBidEstimator(
  createAzureOpenAiJsonClient({
    endpoint: azureOpenAiEndpoint,
    deployment: bidDeployment,
    apiKey: azureOpenAiApiKey,
    apiVersion,
  }),
);

const app = createApp({ verifier, estimator, pricing });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`${AGENT_ID} agent listening on :${info.port}`);
});

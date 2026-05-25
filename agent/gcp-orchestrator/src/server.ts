import { serve } from "@hono/node-server";
import { createRemoteJWKSet } from "jose";
import { createTaskTokenVerifier } from "@agent-tasker/agent";
import { AGENT_ID, startTelemetry } from "./index.js";
import { createApp } from "./app.js";
import { createGaepRuntimeClient } from "./runtime.js";

const telemetry = startTelemetry();
const port = Number(process.env["PORT"] ?? 8080);
const jwksUrl = process.env["JWKS_URL"];
const gaepAgentResourceName = process.env["GAEP_AGENT_RESOURCE_NAME"];

if (!jwksUrl) {
  console.error("JWKS_URL env var is required");
  process.exit(1);
}

const verifier = createTaskTokenVerifier({
  getKey: createRemoteJWKSet(new URL(jwksUrl), { cacheMaxAge: 10 * 60_000 }),
  expectedAudience: AGENT_ID,
});

const runtime = createGaepRuntimeClient({ agentResourceName: gaepAgentResourceName });
const app = createApp({ verifier, runtime });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`${AGENT_ID} agent listening on :${info.port}`);
});

process.once("SIGTERM", () => {
  void telemetry?.shutdown().finally(() => {
    process.exit(0);
  });
});

import { serve } from "@hono/node-server";
import { createRemoteJWKSet } from "jose";
import { createTaskTokenVerifier } from "@agent-tasker/agent";
import { AGENT_ID } from "./index.js";
import { createApp } from "./app.js";

const port = Number(process.env["PORT"] ?? 8080);
const jwksUrl = process.env["JWKS_URL"];

if (!jwksUrl) {
  console.error("JWKS_URL env var is required");
  process.exit(1);
}

const verifier = createTaskTokenVerifier({
  getKey: createRemoteJWKSet(new URL(jwksUrl), { cacheMaxAge: 10 * 60_000 }),
  expectedAudience: AGENT_ID,
});

const app = createApp({ verifier });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`${AGENT_ID} agent listening on :${info.port}`);
});

import { startCoordinatorTelemetry } from "./observability/telemetry.js";
import { serve } from "@hono/node-server";
import { Firestore } from "@google-cloud/firestore";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { createApp } from "./api/app.js";
import {
  HttpAuctionRunner,
  type AgentEndpoint,
  type TaskTokenSigner,
} from "./auction/http-runner.js";
import { StubAuctionRunner } from "./auction/runner.js";
import { FirestoreLedgerStore } from "./ledger/firestore-store.js";
import { SecretManagerKeyProvider } from "./jwt/secret-manager-key-provider.js";
import { signTaskToken } from "./jwt/sign.js";
import { FALLBACK_PRICING } from "@agent-tasker/protocol";

const telemetry = startCoordinatorTelemetry();
const port = Number(process.env["PORT"] ?? 8080);
const projectId = process.env["GCP_PROJECT_ID"];
const signingKeySecretName = process.env["SIGNING_KEY_SECRET_NAME"];
const gcpGeminiUrl = process.env["GCP_GEMINI_AGENT_URL"];
const gcpOrchestratorUrl = process.env["GCP_ORCHESTRATOR_AGENT_URL"];

if (!projectId) {
  console.error("GCP_PROJECT_ID env var is required");
  process.exit(1);
}

const firestore = new Firestore({ projectId });
const store = new FirestoreLedgerStore(firestore);

let runner: HttpAuctionRunner | StubAuctionRunner;

if (signingKeySecretName && gcpGeminiUrl && gcpOrchestratorUrl) {
  const keyProvider = new SecretManagerKeyProvider(
    signingKeySecretName,
    new SecretManagerServiceClient(),
  );
  const tokenSigner: TaskTokenSigner = {
    sign: (args) => signTaskToken(keyProvider, args),
  };
  const agents: AgentEndpoint[] = [
    { agentId: "gcp-gemini", baseUrl: gcpGeminiUrl },
    { agentId: "gcp-orchestrator", baseUrl: gcpOrchestratorUrl },
  ];
  runner = new HttpAuctionRunner({
    store,
    agents,
    tokenSigner,
    pricingSnapshot: Object.values(FALLBACK_PRICING),
    onError: (taskId, err) => {
      console.error(`auction error for task ${taskId}:`, err);
    },
  });
  console.log(`HttpAuctionRunner ready — agents: ${agents.map((a) => a.agentId).join(", ")}`);
} else {
  if (!signingKeySecretName)
    console.warn("SIGNING_KEY_SECRET_NAME not set — using StubAuctionRunner");
  if (!gcpGeminiUrl) console.warn("GCP_GEMINI_AGENT_URL not set — using StubAuctionRunner");
  if (!gcpOrchestratorUrl)
    console.warn("GCP_ORCHESTRATOR_AGENT_URL not set — using StubAuctionRunner");
  runner = new StubAuctionRunner();
}

const app = createApp({ store, runner });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`coordinator listening on :${info.port} (project ${projectId})`);
});

process.once("SIGTERM", () => {
  void telemetry?.shutdown().finally(() => {
    process.exit(0);
  });
});

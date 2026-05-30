import { startCoordinatorTelemetry } from "./observability/telemetry.js";
import { serve } from "@hono/node-server";
import { Firestore } from "@google-cloud/firestore";
import { createApp } from "./api/app.js";
import { StubAuctionRunner } from "./auction/runner.js";
import { FirestoreLedgerStore } from "./ledger/firestore-store.js";

// Cloud Run entrypoint. Reads config from env vars set in Terraform
// (infra/coordinator/cloud_run.tf), wires the Firestore-backed ledger
// and a stub auction runner, and serves the Hono app on $PORT.
//
// The real AuctionRunner (#47 + #52 + #53) replaces StubAuctionRunner
// without changing this entrypoint — server.ts owns wiring, not policy.

const telemetry = startCoordinatorTelemetry();
const port = Number(process.env["PORT"] ?? 8080);
const projectId = process.env["GCP_PROJECT_ID"];
const signingKeySecretName = process.env["SIGNING_KEY_SECRET_NAME"];

if (!projectId) {
  console.error("GCP_PROJECT_ID env var is required");
  process.exit(1);
}

const firestore = new Firestore({ projectId });
const store = new FirestoreLedgerStore(firestore);
const runner = new StubAuctionRunner();

if (signingKeySecretName) {
  console.log(`Using signing key from Secret Manager: ${signingKeySecretName}`);
} else {
  console.warn("SIGNING_KEY_SECRET_NAME not set — JWT signing disabled");
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

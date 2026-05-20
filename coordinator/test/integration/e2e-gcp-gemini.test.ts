import { serve, type ServerType } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { createLocalJWKSet, exportJWK, exportPKCS8, generateKeyPair, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FALLBACK_PRICING, type PricingEntry } from "@agent-tasker/protocol";
import { createTaskTokenVerifier } from "@agent-tasker/agent";
import {
  createApp as createAgentApp,
  type BidEstimator,
  type GenerativeTextClient,
} from "@agent-tasker/agent-gcp-gemini";
import { createApp as createCoordinatorApp } from "../../src/api/app.js";
import { HttpAuctionRunner, type TaskTokenSigner } from "../../src/auction/http-runner.js";
import { signTaskToken, StaticKeyProvider } from "../../src/jwt/index.js";
import { InMemoryLedgerStore } from "../../src/ledger/in-memory-store.js";
import { CreateTaskResponseSchema, GetTaskResponseSchema } from "../../src/api/schemas.js";

// True end-to-end smoke test: real coordinator app + real HttpAuctionRunner
// + real GCP/Gemini Hono app + real JWT signing/verification. Only the LLM
// is stubbed (BidEstimator + GenerativeTextClient inject canned token
// counts + canned output) — every other piece of the protocol surface
// runs unmocked. Locks in the Tier 2 contract before the orchestrator
// agent (#90-#95) joins as the second bidder.

const PRICING: PricingEntry = FALLBACK_PRICING["gemini-2-5-pro"]!;
const PRICING_SNAPSHOT = [PRICING];

const stubEstimator: BidEstimator = {
  async estimate() {
    return { input_tokens: 4000, output_tokens: 1000 };
  },
};

const stubClient: GenerativeTextClient = {
  async generate(prompt) {
    return {
      output: `summary of: ${prompt}`,
      input_tokens: 4100,
      output_tokens: 950,
    };
  },
};

let agentServer: ServerType;
let agentUrl: string;
let coordinatorApp: ReturnType<typeof createCoordinatorApp>;
let store: InMemoryLedgerStore;
let runner: HttpAuctionRunner;
let publicJwk: JWK;

beforeAll(async () => {
  // 1. Generate the coordinator's RS256 keypair.
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const privateKeyPem = await exportPKCS8(privateKey);
  publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "e2e-coordinator-key";

  // 2. Stand up the GCP/Gemini agent app on an ephemeral port. Its verifier
  //    fetches the coordinator's public key from a local JWKS in-memory —
  //    proves the agent will accept tokens signed by the coordinator.
  const verifier = createTaskTokenVerifier({
    getKey: createLocalJWKSet({ keys: [publicJwk] }),
    expectedAudience: "gcp-gemini",
  });
  const agentApp = createAgentApp({
    verifier,
    estimator: stubEstimator,
    client: stubClient,
    pricing: PRICING,
  });
  agentServer = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: agentApp.fetch, port: 0 }, () => resolve(s));
  });
  const address = agentServer.address() as AddressInfo | null;
  if (!address || typeof address === "string") {
    throw new Error("fake agent failed to bind");
  }
  agentUrl = `http://127.0.0.1:${address.port}`;

  // 3. Wire the coordinator's runner with the same keypair so its signer
  //    produces tokens the agent's verifier will accept.
  const keyProvider = new StaticKeyProvider({
    kid: "e2e-coordinator-key",
    privateKeyPem,
  });
  const tokenSigner: TaskTokenSigner = {
    sign: (args) => signTaskToken(keyProvider, args),
  };
  store = new InMemoryLedgerStore();
  runner = new HttpAuctionRunner({
    store,
    agents: [{ agentId: "gcp-gemini", baseUrl: agentUrl }],
    tokenSigner,
    pricingSnapshot: PRICING_SNAPSHOT,
  });
  coordinatorApp = createCoordinatorApp({ store, runner });
});

afterAll(async () => {
  if (agentServer) {
    await new Promise<void>((resolve, reject) => {
      agentServer.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("E2E: client → coordinator → GCP/Gemini → settle", () => {
  it("walks a single-bidder task through announce → bid → execute → settle", async () => {
    const createRes = await coordinatorApp.request("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "summarize the transcript" }),
    });
    expect(createRes.status).toBe(202);
    const created = CreateTaskResponseSchema.parse(await createRes.json());

    // Wait for the runner's fire-and-forget auction to settle. In production
    // the SPA polls GET; in tests we have direct access to the runner's
    // per-task promise.
    await runner.settle(created.task_id);

    const getRes = await coordinatorApp.request(`/tasks/${created.task_id}`);
    expect(getRes.status).toBe(200);
    const fetched = GetTaskResponseSchema.parse(await getRes.json());

    expect(fetched.status).toBe("completed");
    expect(fetched.winner_agent_id).toBe("gcp-gemini");
    // Single bidder → degenerate Vickrey: auction_price == winning_bid.
    expect(fetched.auction_price_usd).toBe(fetched.winning_bid_usd);
    expect(fetched.result?.output).toBe("summary of: summarize the transcript");
    expect(fetched.result?.actual_usage).toEqual({
      input_tokens: 4100,
      output_tokens: 950,
    });

    // Bid was persisted with the pricing snapshot the runner used.
    const bids = await store.listBids(created.task_id);
    expect(bids).toHaveLength(1);
    expect(bids[0]?.agent_id).toBe("gcp-gemini");
    expect(bids[0]?.pricing_snapshot).toEqual(PRICING_SNAPSHOT);
  });

  it("rejects a task whose JWT would mismatch — sanity check that auth is wired", async () => {
    // Hit the agent directly with a body whose task_id differs from any
    // token. Without a valid JWT the agent should 401.
    const res = await fetch(`${agentUrl}/bid`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: "no-such-task", spec: { prompt: "x" } }),
    });
    expect(res.status).toBe(401);
  });
});

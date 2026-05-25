import { serve, type ServerType } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { createLocalJWKSet, exportJWK, exportPKCS8, generateKeyPair, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FALLBACK_PRICING, type PricingEntry } from "@agent-tasker/protocol";
import { createTaskTokenVerifier } from "@agent-tasker/agent";
import {
  createApp as createOrchestratorApp,
  type BidEstimator,
  type GaepRuntimeClient,
} from "@agent-tasker/agent-gcp-orchestrator";
import { createApp as createCoordinatorApp } from "../../src/api/app.js";
import { HttpAuctionRunner, type TaskTokenSigner } from "../../src/auction/http-runner.js";
import { signTaskToken, StaticKeyProvider } from "../../src/jwt/index.js";
import { InMemoryLedgerStore } from "../../src/ledger/in-memory-store.js";
import { CreateTaskResponseSchema, GetTaskResponseSchema } from "../../src/api/schemas.js";

const PRICING: PricingEntry = FALLBACK_PRICING["gemini-2-5-pro"]!;
const PRICING_SNAPSHOT = [PRICING];

const stubEstimator: BidEstimator = {
  async estimate() {
    return { input_tokens: 8000, output_tokens: 2000, steps: 2, tool_calls: 1 };
  },
};

let runtimeExecuteCalls = 0;
const stubRuntime: GaepRuntimeClient = {
  async execute(req) {
    runtimeExecuteCalls += 1;
    return {
      output: `orchestrated result for: ${req.spec.prompt}`,
      input_tokens: 9000,
      output_tokens: 2500,
      step_trace: {
        total_steps: 2,
        tool_call_count: 1,
        steps: [
          {
            index: 0,
            state: "SUCCEEDED",
            description: "Search for relevant context.",
            actions: [
              {
                tool: "search",
                query: "orchestrator task context",
                observation: "retrieved supporting context",
              },
            ],
          },
          {
            index: 1,
            state: "SUCCEEDED",
            description: "Synthesize final answer.",
            actions: [],
          },
        ],
      },
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
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const privateKeyPem = await exportPKCS8(privateKey);
  publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "e2e-orchestrator-key";

  const verifier = createTaskTokenVerifier({
    getKey: createLocalJWKSet({ keys: [publicJwk] }),
    expectedAudience: "gcp-orchestrator",
  });
  const agentApp = createOrchestratorApp({
    verifier,
    estimator: stubEstimator,
    pricing: PRICING,
    runtime: stubRuntime,
  });
  agentServer = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: agentApp.fetch, port: 0 }, () => resolve(s));
  });
  const address = agentServer.address() as AddressInfo | null;
  if (!address || typeof address === "string") {
    throw new Error("orchestrator agent failed to bind");
  }
  agentUrl = `http://127.0.0.1:${address.port}`;

  const keyProvider = new StaticKeyProvider({
    kid: "e2e-orchestrator-key",
    privateKeyPem,
  });
  const tokenSigner: TaskTokenSigner = {
    sign: (args) => signTaskToken(keyProvider, args),
  };
  store = new InMemoryLedgerStore();
  runner = new HttpAuctionRunner({
    store,
    agents: [{ agentId: "gcp-orchestrator", baseUrl: agentUrl }],
    tokenSigner,
    pricingSnapshot: PRICING_SNAPSHOT,
    egressRecorder: () => {},
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

describe("E2E: client → coordinator → GCP/Orchestrator → settle", () => {
  it("walks a GAEP-backed task through bid, execute, step trace persistence, and MAPE", async () => {
    runtimeExecuteCalls = 0;
    const createRes = await coordinatorApp.request("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "research and summarize the architecture" }),
    });
    expect(createRes.status).toBe(202);
    const created = CreateTaskResponseSchema.parse(await createRes.json());

    await runner.settle(created.task_id);

    const getRes = await coordinatorApp.request(`/tasks/${created.task_id}`);
    expect(getRes.status).toBe(200);
    const fetched = GetTaskResponseSchema.parse(await getRes.json());

    expect(fetched.status).toBe("completed");
    expect(fetched.winner_agent_id).toBe("gcp-orchestrator");
    expect(fetched.result?.output).toBe(
      "orchestrated result for: research and summarize the architecture",
    );
    expect(fetched.result?.actual_usage).toEqual({
      input_tokens: 9000,
      output_tokens: 2500,
    });
    expect(runtimeExecuteCalls).toBe(1);
    expect(fetched.result?.step_trace?.total_steps).toBe(2);
    expect(fetched.result?.step_trace?.tool_call_count).toBe(1);
    expect(fetched.result?.step_trace?.steps[0]?.actions[0]).toMatchObject({
      tool: "search",
      query: "orchestrator task context",
    });

    const bids = await store.listBids(created.task_id);
    expect(bids).toHaveLength(1);
    expect(bids[0]?.agent_id).toBe("gcp-orchestrator");
    expect(bids[0]?.response).toMatchObject({
      agent_id: "gcp-orchestrator",
      est_input_tokens: 8000,
      est_output_tokens: 2000,
      bid_usd: 0.03,
    });

    const rollup = await store.getAgentMapeRollup("gcp-orchestrator");
    expect(rollup?.settled_task_count).toBe(1);
    expect(rollup?.last_task_id).toBe(created.task_id);
    expect(rollup?.last_bid_usd).toBeCloseTo(0.03, 10);
    expect(rollup?.last_actual_usd).toBeCloseTo(0.03625, 10);
    expect(rollup?.mape).toBeCloseTo((0.03625 - 0.03) / 0.03, 10);
  });
});

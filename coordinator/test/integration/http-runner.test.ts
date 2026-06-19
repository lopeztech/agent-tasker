import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentId,
  Bid,
  BidResponse,
  JwtPhase,
  PricingEntry,
  TaskId,
  TaskSpec,
  Tier,
} from "@agent-tasker/protocol";
import { InMemoryLedgerStore } from "../../src/ledger/in-memory-store.js";
import {
  type AgentEgressEvent,
  type AgentAccuracyLookup,
  HttpAuctionRunner,
  type AgentEndpoint,
  type TaskTokenSigner,
  cloudLegForAgent,
  estimateHttpRequestBytes,
} from "../../src/auction/http-runner.js";
import type { WebhookSigner } from "../../src/auction/webhook-delivery.js";
import { startFakeAgent, type FakeAgent } from "./fake-agent.js";

const PRICING_SNAPSHOT: PricingEntry[] = [
  {
    model_id: "gemini-2-5-pro",
    price_in_usd_per_mtoken: 1.25,
    price_out_usd_per_mtoken: 10.0,
    effective_date: "2026-05-15",
  },
];

// Token signer that returns a deterministic stub string. The FakeAgent
// doesn't verify JWTs (that path is covered by agent/test/jwt/middleware.test.ts);
// this test just confirms the runner *sends* a Bearer for each request.
const signedTokens: Array<{ agentId: AgentId; phase: JwtPhase }> = [];
const stubSigner: TaskTokenSigner = {
  async sign({ agentId, phase }) {
    signedTokens.push({ agentId, phase });
    return `stub-token.${agentId}.${phase}`;
  },
};

const signedWebhookTokens: Array<{ taskId: TaskId; callbackUrl: string }> = [];
const stubWebhookSigner: WebhookSigner = {
  async sign({ taskId, callbackUrl }) {
    signedWebhookTokens.push({ taskId, callbackUrl });
    return `stub-webhook-token.${taskId}`;
  },
};

function bidFor(agentId: AgentId, bidUsd: number, taskId: string, tier: Tier = "frontier"): Bid {
  return {
    task_id: taskId,
    agent_id: agentId,
    tier,
    model_family: agentId.startsWith("gcp") ? "gemini" : agentId.startsWith("aws") ? "nova" : "gpt",
    model_id: "stub-model",
    est_input_tokens: 4000,
    est_output_tokens: 1000,
    price_in_usd_per_mtoken: 1.25,
    price_out_usd_per_mtoken: 10.0,
    bid_usd: bidUsd,
    expires_at: "2026-05-21T01:00:00Z",
    signature: "stub",
  };
}

let store: InMemoryLedgerStore;
let agents: FakeAgent[];
let callbackServers: Server[];

beforeEach(() => {
  signedTokens.length = 0;
  signedWebhookTokens.length = 0;
  store = new InMemoryLedgerStore();
  agents = [];
  callbackServers = [];
});

afterEach(async () => {
  await Promise.all(agents.map((a) => a.stop()));
  await Promise.all(callbackServers.map((s) => closeServer(s)));
});

async function startAuction(opts: {
  taskId: TaskId;
  endpoints: AgentEndpoint[];
  accuracyByAgent?: AgentAccuracyLookup;
  tieBreakRandom?: () => number;
  bidTimeoutMs?: number;
  spec?: TaskSpec;
  egressRecorder?: (event: AgentEgressEvent) => void;
  webhookSigner?: WebhookSigner;
  callbackMaxAttempts?: number;
  callbackInitialBackoffMs?: number;
  callbackSleep?: (ms: number) => Promise<void>;
  idTokenProvider?: (audience: string) => Promise<string | undefined>;
  onError?: (taskId: TaskId, err: unknown) => void;
}): Promise<HttpAuctionRunner> {
  await store.createTask({
    taskId: opts.taskId,
    spec: opts.spec ?? { prompt: "summarize the transcript" },
  });
  const runner = new HttpAuctionRunner({
    store,
    agents: opts.endpoints,
    tokenSigner: stubSigner,
    pricingSnapshot: PRICING_SNAPSHOT,
    ...(opts.accuracyByAgent !== undefined ? { accuracyByAgent: opts.accuracyByAgent } : {}),
    ...(opts.tieBreakRandom !== undefined ? { tieBreakRandom: opts.tieBreakRandom } : {}),
    ...(opts.bidTimeoutMs !== undefined ? { bidTimeoutMs: opts.bidTimeoutMs } : {}),
    ...(opts.webhookSigner !== undefined ? { webhookSigner: opts.webhookSigner } : {}),
    ...(opts.callbackMaxAttempts !== undefined
      ? { callbackMaxAttempts: opts.callbackMaxAttempts }
      : {}),
    ...(opts.callbackInitialBackoffMs !== undefined
      ? { callbackInitialBackoffMs: opts.callbackInitialBackoffMs }
      : {}),
    ...(opts.callbackSleep !== undefined ? { callbackSleep: opts.callbackSleep } : {}),
    ...(opts.idTokenProvider !== undefined ? { idTokenProvider: opts.idTokenProvider } : {}),
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
    egressRecorder: opts.egressRecorder ?? (() => {}),
  });
  runner.start(opts.taskId);
  await runner.settle(opts.taskId);
  return runner;
}

describe("HttpAuctionRunner", () => {
  it("happy path: two bidders, lowest wins, Vickrey price = other bid", async () => {
    const taskId = "task-happy-1";
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req) => bidFor("gcp-gemini", 0.02, req.task_id),
      onExecute: (req) => ({
        task_id: req.task_id,
        agent_id: "gcp-gemini",
        output: "gemini did it",
        actual_usage: { input_tokens: 4100, output_tokens: 950 },
      }),
    });
    const nova = await startFakeAgent({
      agentId: "aws-nova",
      onBid: (req) => bidFor("aws-nova", 0.04, req.task_id),
    });
    agents.push(gemini, nova);

    await startAuction({
      taskId,
      endpoints: [
        { agentId: "gcp-gemini", baseUrl: gemini.url },
        { agentId: "aws-nova", baseUrl: nova.url },
      ],
    });

    const task = await store.getTask(taskId);
    expect(task?.status).toBe("completed");
    expect(task?.winner_agent_id).toBe("gcp-gemini");
    expect(task?.winning_bid_usd).toBe(0.02);
    // Second-lowest is 0.04, so auction_price = 0.04
    expect(task?.auction_price_usd).toBe(0.04);
    expect(task?.result?.output).toBe("gemini did it");

    // Per-phase JWTs: 2× bid + 1× execute = 3 total
    expect(signedTokens).toEqual([
      { agentId: "gcp-gemini", phase: "bid" },
      { agentId: "aws-nova", phase: "bid" },
      { agentId: "gcp-gemini", phase: "execute" },
    ]);

    expect(gemini.bidCalls).toBe(1);
    expect(gemini.executeCalls).toBe(1);
    expect(nova.bidCalls).toBe(1);
    expect(nova.executeCalls).toBe(0);
  });

  it("delivers signed completion callbacks with a stable idempotency key", async () => {
    const taskId = "task-callback";
    const deliveries: CallbackRequest[] = [];
    const callback = await startCallbackServer(async (req, body) => {
      deliveries.push(toCallbackRequest(req, body));
      return { status: 204 };
    });
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req) => bidFor("gcp-gemini", 0.02, req.task_id),
      onExecute: (req) => ({
        task_id: req.task_id,
        agent_id: "gcp-gemini",
        output: "gemini did it",
        actual_usage: { input_tokens: 4100, output_tokens: 950 },
      }),
    });
    agents.push(gemini);

    await startAuction({
      taskId,
      endpoints: [{ agentId: "gcp-gemini", baseUrl: gemini.url }],
      spec: { prompt: "summarize the transcript", callback_url: callback.url },
      webhookSigner: stubWebhookSigner,
    });

    expect(signedWebhookTokens).toEqual([{ taskId, callbackUrl: callback.url }]);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      authorization: `Bearer stub-webhook-token.${taskId}`,
      idempotencyKey: `task:${taskId}:completed`,
      event: "task.completed",
      body: {
        task_id: taskId,
        status: "completed",
        winner_agent_id: "gcp-gemini",
        auction_price_usd: 0.02,
        result: {
          task_id: taskId,
          agent_id: "gcp-gemini",
          output: "gemini did it",
          actual_usage: { input_tokens: 4100, output_tokens: 950 },
        },
      },
    });
  });

  it("retries callback delivery with the same idempotency key", async () => {
    const taskId = "task-callback-retry";
    const deliveries: CallbackRequest[] = [];
    const callback = await startCallbackServer(async (req, body) => {
      deliveries.push(toCallbackRequest(req, body));
      return { status: deliveries.length < 3 ? 500 : 204 };
    });
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req) => bidFor("gcp-gemini", 0.02, req.task_id),
      onExecute: (req) => ({
        task_id: req.task_id,
        agent_id: "gcp-gemini",
        output: "gemini did it",
        actual_usage: { input_tokens: 4100, output_tokens: 950 },
      }),
    });
    agents.push(gemini);

    await startAuction({
      taskId,
      endpoints: [{ agentId: "gcp-gemini", baseUrl: gemini.url }],
      spec: { prompt: "summarize the transcript", callback_url: callback.url },
      webhookSigner: stubWebhookSigner,
      callbackInitialBackoffMs: 1,
      callbackSleep: async () => {},
    });

    expect(deliveries).toHaveLength(3);
    expect(new Set(deliveries.map((d) => d.idempotencyKey))).toEqual(
      new Set([`task:${taskId}:completed`]),
    );
    const task = await store.getTask(taskId);
    expect(task?.status).toBe("completed");
  });

  it("single bidder: degenerate Vickrey price equals the winner's own bid", async () => {
    const taskId = "task-single";
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req) => bidFor("gcp-gemini", 0.02, req.task_id),
    });
    const nova = await startFakeAgent({
      agentId: "aws-nova",
      // default handler declines
    });
    agents.push(gemini, nova);

    await startAuction({
      taskId,
      endpoints: [
        { agentId: "gcp-gemini", baseUrl: gemini.url },
        { agentId: "aws-nova", baseUrl: nova.url },
      ],
    });

    const task = await store.getTask(taskId);
    expect(task?.status).toBe("completed");
    expect(task?.winner_agent_id).toBe("gcp-gemini");
    expect(task?.winning_bid_usd).toBe(0.02);
    expect(task?.auction_price_usd).toBe(0.02);

    // Nova's decline was still recorded
    const bids = await store.listBids(taskId);
    const novaRecord = bids.find((b) => b.agent_id === "aws-nova");
    expect(novaRecord).toMatchObject({
      response_kind: "no_bid",
      no_bid_reason: "capability",
      mape_eligible: false,
    });
    expect(novaRecord?.response).toMatchObject({ status: "no_bid", reason: "capability" });
  });

  it("applies min_tier before winner selection", async () => {
    const taskId = "task-min-tier-frontier";
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req) => bidFor("gcp-gemini", 0.01, req.task_id, "small"),
    });
    const nova = await startFakeAgent({
      agentId: "aws-nova",
      onBid: (req) => bidFor("aws-nova", 0.04, req.task_id, "frontier"),
      onExecute: (req) => ({
        task_id: req.task_id,
        agent_id: "aws-nova",
        output: "nova did it",
        actual_usage: { input_tokens: 3900, output_tokens: 900 },
      }),
    });
    agents.push(gemini, nova);

    await startAuction({
      taskId,
      endpoints: [
        { agentId: "gcp-gemini", baseUrl: gemini.url },
        { agentId: "aws-nova", baseUrl: nova.url },
      ],
      spec: { prompt: "summarize the transcript", min_tier: "frontier" },
    });

    const task = await store.getTask(taskId);
    expect(task?.status).toBe("completed");
    expect(task?.winner_agent_id).toBe("aws-nova");
    expect(task?.winning_bid_usd).toBe(0.04);
    expect(task?.auction_price_usd).toBe(0.04);

    const bids = await store.listBids(taskId);
    expect(bids.map((bid) => bid.agent_id).sort()).toEqual(["aws-nova", "gcp-gemini"]);
  });

  it("breaks tied lowest bids by historical MAPE", async () => {
    const taskId = "task-tied-mape";
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req) => bidFor("gcp-gemini", 0.02, req.task_id),
    });
    const nova = await startFakeAgent({
      agentId: "aws-nova",
      onBid: (req) => bidFor("aws-nova", 0.02, req.task_id),
      onExecute: (req) => ({
        task_id: req.task_id,
        agent_id: "aws-nova",
        output: "nova did it",
        actual_usage: { input_tokens: 3900, output_tokens: 900 },
      }),
    });
    agents.push(gemini, nova);

    await startAuction({
      taskId,
      endpoints: [
        { agentId: "gcp-gemini", baseUrl: gemini.url },
        { agentId: "aws-nova", baseUrl: nova.url },
      ],
      accuracyByAgent: {
        "gcp-gemini": { mape: 0.2, settledTaskCount: 10 },
        "aws-nova": { mape: 0.05, settledTaskCount: 10 },
      },
    });

    const task = await store.getTask(taskId);
    expect(task?.status).toBe("completed");
    expect(task?.winner_agent_id).toBe("aws-nova");
    expect(task?.winning_bid_usd).toBe(0.02);
    expect(task?.auction_price_usd).toBe(0.02);
  });

  it("uses random cold-start fallback when tied agents have too few settled tasks", async () => {
    const taskId = "task-tied-cold-start";
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req) => bidFor("gcp-gemini", 0.02, req.task_id),
    });
    const nova = await startFakeAgent({
      agentId: "aws-nova",
      onBid: (req) => bidFor("aws-nova", 0.02, req.task_id),
      onExecute: (req) => ({
        task_id: req.task_id,
        agent_id: "aws-nova",
        output: "nova did it",
        actual_usage: { input_tokens: 3900, output_tokens: 900 },
      }),
    });
    agents.push(gemini, nova);

    await startAuction({
      taskId,
      endpoints: [
        { agentId: "gcp-gemini", baseUrl: gemini.url },
        { agentId: "aws-nova", baseUrl: nova.url },
      ],
      accuracyByAgent: {
        "gcp-gemini": { mape: 0.2, settledTaskCount: 9 },
        "aws-nova": { mape: 0.05, settledTaskCount: 9 },
      },
      tieBreakRandom: () => 0.75,
    });

    const task = await store.getTask(taskId);
    expect(task?.status).toBe("completed");
    expect(task?.winner_agent_id).toBe("aws-nova");
    expect(task?.winning_bid_usd).toBe(0.02);
    expect(task?.auction_price_usd).toBe(0.02);
  });

  it("all agents decline → task fails with reason listing decline codes", async () => {
    const taskId = "task-all-decline";
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req): BidResponse => ({
        task_id: req.task_id,
        agent_id: "gcp-gemini",
        status: "no_bid",
        reason: "context_overflow",
      }),
    });
    const nova = await startFakeAgent({
      agentId: "aws-nova",
      onBid: (req): BidResponse => ({
        task_id: req.task_id,
        agent_id: "aws-nova",
        status: "no_bid",
        reason: "policy",
      }),
    });
    agents.push(gemini, nova);

    await startAuction({
      taskId,
      endpoints: [
        { agentId: "gcp-gemini", baseUrl: gemini.url },
        { agentId: "aws-nova", baseUrl: nova.url },
      ],
    });

    const task = await store.getTask(taskId);
    expect(task?.status).toBe("failed");
    expect(task?.failure_reason).toContain("context_overflow");
    expect(task?.failure_reason).toContain("policy");
  });

  it("unreachable agent is treated as no_bid: internal_error", async () => {
    const taskId = "task-unreachable";
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req) => bidFor("gcp-gemini", 0.02, req.task_id),
    });
    agents.push(gemini);

    await startAuction({
      taskId,
      endpoints: [
        { agentId: "gcp-gemini", baseUrl: gemini.url },
        // Port 1 should always refuse connections; runner should treat as decline
        { agentId: "aws-nova", baseUrl: "http://127.0.0.1:1" },
      ],
      bidTimeoutMs: 1500,
    });

    const task = await store.getTask(taskId);
    expect(task?.status).toBe("completed");
    expect(task?.winner_agent_id).toBe("gcp-gemini");

    const bids = await store.listBids(taskId);
    const novaRecord = bids.find((b) => b.agent_id === "aws-nova");
    expect(novaRecord).toMatchObject({
      response_kind: "no_bid",
      no_bid_reason: "internal_error",
      mape_eligible: false,
    });
    expect(novaRecord?.response).toMatchObject({ status: "no_bid", reason: "internal_error" });
  });

  it("execute failure → task fails with reason mentioning the winner", async () => {
    const taskId = "task-execute-fail";
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req) => bidFor("gcp-gemini", 0.02, req.task_id),
      onExecute: () => {
        throw new Error("model overloaded");
      },
    });
    agents.push(gemini);

    await startAuction({
      taskId,
      endpoints: [{ agentId: "gcp-gemini", baseUrl: gemini.url }],
    });

    const task = await store.getTask(taskId);
    expect(task?.status).toBe("failed");
    expect(task?.failure_reason).toMatch(/gcp-gemini/);
    expect(task?.failure_reason).toMatch(/500|execute/i);
  });

  it("re-auctions after execute failure and settles with the next winner", async () => {
    const taskId = "task-reauction";
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req) => bidFor("gcp-gemini", 0.01, req.task_id),
      onExecute: () => {
        throw new Error("model overloaded");
      },
    });
    const nova = await startFakeAgent({
      agentId: "aws-nova",
      onBid: (req) => bidFor("aws-nova", 0.02, req.task_id),
      onExecute: (req) => ({
        task_id: req.task_id,
        agent_id: "aws-nova",
        output: "nova recovered it",
        actual_usage: { input_tokens: 4000, output_tokens: 1000 },
      }),
    });
    const azure = await startFakeAgent({
      agentId: "azure-gpt",
      onBid: (req) => bidFor("azure-gpt", 0.03, req.task_id),
    });
    agents.push(gemini, nova, azure);

    await startAuction({
      taskId,
      endpoints: [
        { agentId: "gcp-gemini", baseUrl: gemini.url },
        { agentId: "aws-nova", baseUrl: nova.url },
        { agentId: "azure-gpt", baseUrl: azure.url },
      ],
    });

    const task = await store.getTask(taskId);
    expect(task?.status).toBe("completed");
    expect(task?.winner_agent_id).toBe("aws-nova");
    expect(task?.winning_bid_usd).toBe(0.02);
    expect(task?.auction_price_usd).toBe(0.03);
    expect(task?.result?.output).toBe("nova recovered it");

    expect(gemini.executeCalls).toBe(1);
    expect(nova.executeCalls).toBe(1);
    expect(azure.executeCalls).toBe(0);
  });

  it("treats execution overrun as failure and re-auctions", async () => {
    const taskId = "task-overrun-reauction";
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req) => bidFor("gcp-gemini", 0.001, req.task_id),
      onExecute: (req) => ({
        task_id: req.task_id,
        agent_id: "gcp-gemini",
        output: "too expensive",
        actual_usage: { input_tokens: 20_000_000, output_tokens: 0 },
      }),
    });
    const nova = await startFakeAgent({
      agentId: "aws-nova",
      onBid: (req) => bidFor("aws-nova", 0.02, req.task_id),
      onExecute: (req) => ({
        task_id: req.task_id,
        agent_id: "aws-nova",
        output: "nova stayed in budget",
        actual_usage: { input_tokens: 4000, output_tokens: 1000 },
      }),
    });
    const azure = await startFakeAgent({
      agentId: "azure-gpt",
      onBid: (req) => bidFor("azure-gpt", 0.03, req.task_id),
    });
    agents.push(gemini, nova, azure);

    await startAuction({
      taskId,
      endpoints: [
        { agentId: "gcp-gemini", baseUrl: gemini.url },
        { agentId: "aws-nova", baseUrl: nova.url },
        { agentId: "azure-gpt", baseUrl: azure.url },
      ],
    });

    const task = await store.getTask(taskId);
    expect(task?.status).toBe("completed");
    expect(task?.winner_agent_id).toBe("aws-nova");
    expect(task?.winning_bid_usd).toBe(0.02);
    expect(task?.auction_price_usd).toBe(0.03);
    expect(task?.result?.output).toBe("nova stayed in budget");

    expect(gemini.executeCalls).toBe(1);
    expect(nova.executeCalls).toBe(1);
    expect(azure.executeCalls).toBe(0);
  });

  it("records per-agent request egress for cross-cloud smoke tests", async () => {
    const taskId = "task-egress-smoke";
    const egressEvents: AgentEgressEvent[] = [];
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req) => bidFor("gcp-gemini", 0.02, req.task_id),
      onExecute: (req) => ({
        task_id: req.task_id,
        agent_id: "gcp-gemini",
        output: "gemini did it",
        actual_usage: { input_tokens: 4000, output_tokens: 1000 },
      }),
    });
    const nova = await startFakeAgent({
      agentId: "aws-nova",
      onBid: (req) => bidFor("aws-nova", 0.04, req.task_id),
    });
    const azure = await startFakeAgent({
      agentId: "azure-gpt",
      onBid: (req) => bidFor("azure-gpt", 0.06, req.task_id),
    });
    agents.push(gemini, nova, azure);

    await startAuction({
      taskId,
      endpoints: [
        { agentId: "gcp-gemini", baseUrl: gemini.url },
        { agentId: "aws-nova", baseUrl: nova.url },
        { agentId: "azure-gpt", baseUrl: azure.url },
      ],
      egressRecorder: (event) => egressEvents.push(event),
    });

    expect(egressEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_id: taskId,
          agent_id: "gcp-gemini",
          phase: "bid",
          cloud_leg: "gcp",
          cross_cloud_billable: false,
        }),
        expect.objectContaining({
          task_id: taskId,
          agent_id: "aws-nova",
          phase: "bid",
          cloud_leg: "aws",
          cross_cloud_billable: true,
        }),
        expect.objectContaining({
          task_id: taskId,
          agent_id: "azure-gpt",
          phase: "bid",
          cloud_leg: "azure",
          cross_cloud_billable: true,
        }),
        expect.objectContaining({
          task_id: taskId,
          agent_id: "gcp-gemini",
          phase: "execute",
          cloud_leg: "gcp",
          cross_cloud_billable: false,
        }),
      ]),
    );
    expect(egressEvents.every((event) => event.bytes_out > 0)).toBe(true);
  });

  it("sends OIDC X-Serverless-Authorization to GCP agents only, task JWT to all", async () => {
    const taskId = "task-oidc-invoker";
    const audiences: string[] = [];
    const gemini = await startFakeAgent({
      agentId: "gcp-gemini",
      onBid: (req) => bidFor("gcp-gemini", 0.02, req.task_id),
      onExecute: (req) => ({
        task_id: req.task_id,
        agent_id: "gcp-gemini",
        output: "gemini did it",
        actual_usage: { input_tokens: 4000, output_tokens: 1000 },
      }),
    });
    const nova = await startFakeAgent({
      agentId: "aws-nova",
      onBid: (req) => bidFor("aws-nova", 0.04, req.task_id),
    });
    agents.push(gemini, nova);

    await startAuction({
      taskId,
      endpoints: [
        { agentId: "gcp-gemini", baseUrl: gemini.url },
        { agentId: "aws-nova", baseUrl: nova.url },
      ],
      idTokenProvider: async (audience) => {
        audiences.push(audience);
        return `id-token-for.${audience}`;
      },
    });

    // GCP agent: Cloud Run IAM token in X-Serverless-Authorization, task JWT in
    // Authorization. Both bid and execute requests carry it.
    expect(gemini.requests.length).toBeGreaterThanOrEqual(2);
    for (const req of gemini.requests) {
      expect(req.authorization).toBe(
        `Bearer stub-token.gcp-gemini.${req.path === "/bid" ? "bid" : "execute"}`,
      );
      expect(req.serverlessAuthorization).toBe(`Bearer id-token-for.${gemini.url}`);
    }
    // The ID token audience is the agent's base URL (Cloud Run service URL).
    expect(audiences).toContain(gemini.url);

    // Non-GCP agent: task JWT only; no OIDC token requested for its audience.
    const novaBid = nova.requests.find((r) => r.path === "/bid");
    expect(novaBid?.authorization).toBe("Bearer stub-token.aws-nova.bid");
    expect(novaBid?.serverlessAuthorization).toBeUndefined();
    expect(audiences).not.toContain(nova.url);
  });

  it("estimates request bytes with UTF-8 body and header length", () => {
    const bytes = estimateHttpRequestBytes({
      method: "POST",
      path: "/bid",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify({ prompt: "hello µ" }),
    });

    expect(bytes).toBeGreaterThan(JSON.stringify({ prompt: "hello µ" }).length);
  });

  it("maps agent ids to cloud legs used by the egress dashboard", () => {
    expect(cloudLegForAgent("gcp-gemini")).toBe("gcp");
    expect(cloudLegForAgent("gcp-orchestrator")).toBe("gcp");
    expect(cloudLegForAgent("aws-nova")).toBe("aws");
    expect(cloudLegForAgent("azure-gpt")).toBe("azure");
  });
});

interface CallbackRequest {
  authorization: string | undefined;
  idempotencyKey: string | undefined;
  event: string | undefined;
  body: unknown;
}

async function startCallbackServer(
  handler: (
    req: IncomingMessage,
    body: unknown,
  ) => Promise<{ status: number; body?: unknown }> | { status: number; body?: unknown },
): Promise<{ url: string }> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const bodyText = await readRequestBody(req);
    const body = bodyText ? JSON.parse(bodyText) : null;
    const response = await handler(req, body);
    res.statusCode = response.status;
    if (response.body !== undefined) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(response.body));
      return;
    }
    res.end();
  });
  callbackServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo | null;
  if (!address || typeof address === "string") {
    throw new Error("callback server failed to bind");
  }
  return { url: `http://127.0.0.1:${address.port}/callback` };
}

function toCallbackRequest(req: IncomingMessage, body: unknown): CallbackRequest {
  return {
    authorization: req.headers.authorization,
    idempotencyKey: headerValue(req.headers["idempotency-key"]),
    event: headerValue(req.headers["x-agent-tasker-event"]),
    body,
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

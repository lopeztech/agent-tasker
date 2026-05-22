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
  type AgentAccuracyLookup,
  HttpAuctionRunner,
  type AgentEndpoint,
  type TaskTokenSigner,
} from "../../src/auction/http-runner.js";
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

beforeEach(() => {
  signedTokens.length = 0;
  store = new InMemoryLedgerStore();
  agents = [];
});

afterEach(async () => {
  await Promise.all(agents.map((a) => a.stop()));
});

async function startAuction(opts: {
  taskId: TaskId;
  endpoints: AgentEndpoint[];
  accuracyByAgent?: AgentAccuracyLookup;
  tieBreakRandom?: () => number;
  bidTimeoutMs?: number;
  spec?: TaskSpec;
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
});

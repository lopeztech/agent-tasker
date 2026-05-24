import { beforeEach, describe, expect, it } from "vitest";
import type { AgentId, Bid, NoBid, PricingEntry, Result, TaskSpec } from "@agent-tasker/protocol";
import { InMemoryLedgerStore } from "../../src/ledger/in-memory-store.js";
import { LedgerReplayTaskNotFoundError, replayTaskFromLedger } from "../../src/ledger/replay.js";

const TASK_ID = "task-replay-1";
const SPEC: TaskSpec = { prompt: "summarize the attached transcript" };
const PRICING: PricingEntry[] = [
  {
    model_id: "gemini-2-5-pro",
    price_in_usd_per_mtoken: 1.25,
    price_out_usd_per_mtoken: 10,
    effective_date: "2026-05-15",
  },
];

function makeBid(agentId: AgentId, bidUsd: number): Bid {
  return {
    task_id: TASK_ID,
    agent_id: agentId,
    tier: "frontier",
    model_family: agentId === "aws-nova" ? "nova" : "gemini",
    model_id: agentId === "aws-nova" ? "amazon.nova-pro" : "gemini-2-5-pro",
    est_input_tokens: 4000,
    est_output_tokens: 1000,
    price_in_usd_per_mtoken: 1.25,
    price_out_usd_per_mtoken: 10,
    bid_usd: bidUsd,
    expires_at: "2026-05-20T12:00:00Z",
    signature: "stub",
  };
}

function makeNoBid(agentId: AgentId): NoBid {
  return {
    task_id: TASK_ID,
    agent_id: agentId,
    status: "no_bid",
    reason: "capability",
  };
}

function makeResult(agentId: AgentId): Result {
  return {
    task_id: TASK_ID,
    agent_id: agentId,
    output: "summary text",
    actual_usage: { input_tokens: 4100, output_tokens: 950 },
  };
}

let store: InMemoryLedgerStore;

beforeEach(() => {
  store = new InMemoryLedgerStore();
});

describe("replayTaskFromLedger", () => {
  it("reconstructs bids, no_bids, award, pricing snapshot, and settlement math", async () => {
    await store.createTask({ taskId: TASK_ID, spec: SPEC });
    await store.recordBidResponse({
      taskId: TASK_ID,
      response: makeBid("gcp-gemini", 0.02),
      pricingSnapshot: PRICING,
    });
    await store.recordBidResponse({
      taskId: TASK_ID,
      response: makeBid("aws-nova", 0.04),
      pricingSnapshot: PRICING,
    });
    await store.recordBidResponse({
      taskId: TASK_ID,
      response: makeNoBid("gcp-orchestrator"),
      pricingSnapshot: PRICING,
    });
    await store.awardTask({
      taskId: TASK_ID,
      winnerAgentId: "gcp-gemini",
      winningBidUsd: 0.02,
      auctionPriceUsd: 0.04,
    });
    await store.markExecuting(TASK_ID);
    await store.completeTask({ taskId: TASK_ID, result: makeResult("gcp-gemini") });

    const replay = await replayTaskFromLedger(store, TASK_ID);

    expect(replay.task.status).toBe("completed");
    expect(replay.bids).toEqual([
      expect.objectContaining({
        agent_id: "gcp-gemini",
        bid_usd: 0.02,
        pricing_snapshot: PRICING,
      }),
      expect.objectContaining({
        agent_id: "aws-nova",
        bid_usd: 0.04,
        pricing_snapshot: PRICING,
      }),
    ]);
    expect(replay.no_bids).toEqual([{ agent_id: "gcp-orchestrator", reason: "capability" }]);
    expect(replay.award).toEqual({
      winner_agent_id: "gcp-gemini",
      winning_bid_usd: 0.02,
      auction_price_usd: 0.04,
    });
    expect(replay.settlement).toMatchObject({
      winner_agent_id: "gcp-gemini",
      output: "summary text",
      actual_usage: { input_tokens: 4100, output_tokens: 950 },
    });
    expect(replay.settlement?.actual_usd_from_bid_prices).toBeCloseTo(0.014625);
    expect(replay.settlement?.bid_error_usd).toBeCloseTo(-0.005375);
    expect(replay.settlement?.absolute_percentage_error).toBeCloseTo(0.26875);
  });

  it("returns null award and settlement for an unawarded task", async () => {
    await store.createTask({ taskId: TASK_ID, spec: SPEC });
    await store.recordBidResponse({
      taskId: TASK_ID,
      response: makeBid("gcp-gemini", 0.02),
      pricingSnapshot: PRICING,
    });

    const replay = await replayTaskFromLedger(store, TASK_ID);

    expect(replay.award).toBeNull();
    expect(replay.settlement).toBeNull();
    expect(replay.bids).toHaveLength(1);
  });

  it("throws a typed error for missing tasks", async () => {
    await expect(replayTaskFromLedger(store, "missing")).rejects.toThrow(
      LedgerReplayTaskNotFoundError,
    );
  });
});

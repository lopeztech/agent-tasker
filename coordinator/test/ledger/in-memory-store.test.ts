import { describe, it, expect, beforeEach } from "vitest";
import type { AgentId, Bid, NoBid, PricingEntry, Result, TaskSpec } from "@agent-tasker/protocol";
import { InMemoryLedgerStore } from "../../src/ledger/in-memory-store.js";
import {
  InvalidTransitionError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
} from "../../src/auction/state-machine.js";

const TASK_ID = "task-test-1";

const SPEC: TaskSpec = {
  prompt: "summarize the attached transcript",
};

const PRICING: PricingEntry[] = [
  {
    model_id: "gemini-2-5-flash",
    price_in_usd_per_mtoken: 0.3,
    price_out_usd_per_mtoken: 2.5,
    effective_date: "2026-05-15",
  },
];

function makeBid(agentId: AgentId, bidUsd: number): Bid {
  return {
    task_id: TASK_ID,
    agent_id: agentId,
    tier: "frontier",
    model_family: "gemini",
    model_id: "gemini-2-5-pro",
    est_input_tokens: 4000,
    est_output_tokens: 1000,
    price_in_usd_per_mtoken: 1.25,
    price_out_usd_per_mtoken: 10.0,
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

describe("createTask", () => {
  it("creates a task in the bidding state with matching timestamps", async () => {
    const now = new Date("2026-05-20T10:00:00Z");
    const record = await store.createTask({ taskId: TASK_ID, spec: SPEC, now });
    expect(record.status).toBe("bidding");
    expect(record.spec).toEqual(SPEC);
    expect(record.created_at).toBe(now.toISOString());
    expect(record.updated_at).toBe(now.toISOString());
  });

  it("throws TaskAlreadyExistsError on duplicate task_id", async () => {
    await store.createTask({ taskId: TASK_ID, spec: SPEC });
    await expect(store.createTask({ taskId: TASK_ID, spec: SPEC })).rejects.toThrow(
      TaskAlreadyExistsError,
    );
  });

  it("returned record is a clone — caller mutation doesn't leak", async () => {
    const record = await store.createTask({ taskId: TASK_ID, spec: SPEC });
    record.status = "completed";
    const fetched = await store.getTask(TASK_ID);
    expect(fetched?.status).toBe("bidding");
  });
});

describe("getTask", () => {
  it("returns null for unknown task_id", async () => {
    expect(await store.getTask("missing")).toBeNull();
  });
});

describe("recordBidResponse", () => {
  beforeEach(async () => {
    await store.createTask({ taskId: TASK_ID, spec: SPEC });
  });

  it("stores a bid and lists it back", async () => {
    const bid = makeBid("gcp-gemini", 0.02);
    await store.recordBidResponse({
      taskId: TASK_ID,
      response: bid,
      pricingSnapshot: PRICING,
    });
    const bids = await store.listBids(TASK_ID);
    expect(bids).toHaveLength(1);
    expect(bids[0]?.phase).toBe("bid");
    expect(bids[0]?.response).toEqual(bid);
    expect(bids[0]?.pricing_snapshot).toEqual(PRICING);
  });

  it("stores a no_bid alongside a bid from a different agent", async () => {
    await store.recordBidResponse({
      taskId: TASK_ID,
      response: makeBid("gcp-gemini", 0.02),
      pricingSnapshot: PRICING,
    });
    await store.recordBidResponse({
      taskId: TASK_ID,
      response: makeNoBid("aws-nova"),
      pricingSnapshot: PRICING,
    });
    const bids = await store.listBids(TASK_ID);
    expect(bids).toHaveLength(2);
    const byAgent = Object.fromEntries(bids.map((b) => [b.agent_id, b]));
    expect(byAgent["gcp-gemini"]?.response).toMatchObject({ bid_usd: 0.02 });
    expect(byAgent["aws-nova"]?.response).toMatchObject({
      status: "no_bid",
      reason: "capability",
    });
  });

  it("is idempotent on (task_id, agent_id) — final write wins", async () => {
    await store.recordBidResponse({
      taskId: TASK_ID,
      response: makeBid("gcp-gemini", 0.05),
      pricingSnapshot: PRICING,
    });
    await store.recordBidResponse({
      taskId: TASK_ID,
      response: makeBid("gcp-gemini", 0.02),
      pricingSnapshot: PRICING,
    });
    const bids = await store.listBids(TASK_ID);
    expect(bids).toHaveLength(1);
    expect(bids[0]?.response).toMatchObject({ bid_usd: 0.02 });
  });

  it("rejects writes after the bidding window has closed", async () => {
    await store.awardTask({
      taskId: TASK_ID,
      winnerAgentId: "gcp-gemini",
      auctionPriceUsd: 0.05,
      winningBidUsd: 0.02,
    });
    await expect(
      store.recordBidResponse({
        taskId: TASK_ID,
        response: makeBid("aws-nova", 0.04),
        pricingSnapshot: PRICING,
      }),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("throws TaskNotFoundError when the task is unknown", async () => {
    await expect(
      store.recordBidResponse({
        taskId: "missing",
        response: makeBid("gcp-gemini", 0.02),
        pricingSnapshot: PRICING,
      }),
    ).rejects.toThrow(TaskNotFoundError);
  });
});

describe("awardTask", () => {
  beforeEach(async () => {
    await store.createTask({ taskId: TASK_ID, spec: SPEC });
  });

  it("transitions bidding -> awarded and records winner + prices", async () => {
    const record = await store.awardTask({
      taskId: TASK_ID,
      winnerAgentId: "gcp-gemini",
      auctionPriceUsd: 0.05,
      winningBidUsd: 0.02,
    });
    expect(record.status).toBe("awarded");
    expect(record.winner_agent_id).toBe("gcp-gemini");
    expect(record.auction_price_usd).toBe(0.05);
    expect(record.winning_bid_usd).toBe(0.02);
  });

  it("is idempotent when the same winner + prices are reasserted", async () => {
    const first = await store.awardTask({
      taskId: TASK_ID,
      winnerAgentId: "gcp-gemini",
      auctionPriceUsd: 0.05,
      winningBidUsd: 0.02,
    });
    const second = await store.awardTask({
      taskId: TASK_ID,
      winnerAgentId: "gcp-gemini",
      auctionPriceUsd: 0.05,
      winningBidUsd: 0.02,
    });
    expect(second.updated_at).toBe(first.updated_at);
  });

  it("rejects awarding a different winner once the task is already awarded", async () => {
    await store.awardTask({
      taskId: TASK_ID,
      winnerAgentId: "gcp-gemini",
      auctionPriceUsd: 0.05,
      winningBidUsd: 0.02,
    });
    await expect(
      store.awardTask({
        taskId: TASK_ID,
        winnerAgentId: "aws-nova",
        auctionPriceUsd: 0.04,
        winningBidUsd: 0.03,
      }),
    ).rejects.toThrow(InvalidTransitionError);
  });
});

describe("markExecuting / completeTask / failTask", () => {
  beforeEach(async () => {
    await store.createTask({ taskId: TASK_ID, spec: SPEC });
    await store.awardTask({
      taskId: TASK_ID,
      winnerAgentId: "gcp-gemini",
      auctionPriceUsd: 0.05,
      winningBidUsd: 0.02,
    });
  });

  it("markExecuting transitions awarded -> executing", async () => {
    const record = await store.markExecuting(TASK_ID);
    expect(record.status).toBe("executing");
  });

  it("markExecuting is idempotent", async () => {
    const first = await store.markExecuting(TASK_ID);
    const second = await store.markExecuting(TASK_ID);
    expect(second.updated_at).toBe(first.updated_at);
  });

  it("completeTask transitions executing -> completed and stores the result", async () => {
    await store.markExecuting(TASK_ID);
    const result = makeResult("gcp-gemini");
    const record = await store.completeTask({ taskId: TASK_ID, result });
    expect(record.status).toBe("completed");
    expect(record.result).toEqual(result);
  });

  it("completeTask rejects directly from awarded (must mark executing first)", async () => {
    await expect(
      store.completeTask({ taskId: TASK_ID, result: makeResult("gcp-gemini") }),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("failTask works from any non-terminal state and records the reason", async () => {
    const failed = await store.failTask({ taskId: TASK_ID, reason: "agent timeout" });
    expect(failed.status).toBe("failed");
    expect(failed.failure_reason).toBe("agent timeout");
  });

  it("failTask is rejected from a terminal state", async () => {
    await store.markExecuting(TASK_ID);
    await store.completeTask({ taskId: TASK_ID, result: makeResult("gcp-gemini") });
    await expect(store.failTask({ taskId: TASK_ID, reason: "too late" })).rejects.toThrow(
      InvalidTransitionError,
    );
  });
});

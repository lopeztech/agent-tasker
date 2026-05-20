import { describe, expect, it } from "vitest";
import type { TaskId } from "@agent-tasker/protocol";
import { createApp } from "../../src/api/app.js";
import { InMemoryLedgerStore } from "../../src/ledger/in-memory-store.js";
import { GetTaskResponseSchema, CreateTaskResponseSchema } from "../../src/api/schemas.js";
import { ScriptedAuctionRunner } from "./scripted-runner.js";

// End-to-end exercise of: client POST → coordinator creates task →
// ScriptedAuctionRunner runs a synthesized auction against the ledger →
// client GET observes the settled state.
//
// Does not exercise the real auction-runner code (#47/#52/#53). It does
// pin the contract those issues have to honor: same LedgerStore API,
// same status transitions, same projected response shape.

const PRICING_SNAPSHOT = [
  {
    model_id: "gemini-2-5-pro",
    price_in_usd_per_mtoken: 1.25,
    price_out_usd_per_mtoken: 10.0,
    effective_date: "2026-05-15",
  },
];

describe("coordinator lifecycle (POST → script → GET)", () => {
  it("happy path: bidding → awarded → executing → completed", async () => {
    const store = new InMemoryLedgerStore();
    const runner = new ScriptedAuctionRunner(async (taskId: TaskId) => {
      // Two agents bid; gcp-gemini undercuts aws-nova.
      await store.recordBidResponse({
        taskId,
        response: {
          task_id: taskId,
          agent_id: "gcp-gemini",
          tier: "frontier",
          model_family: "gemini",
          model_id: "gemini-2-5-pro",
          est_input_tokens: 4000,
          est_output_tokens: 1000,
          price_in_usd_per_mtoken: 1.25,
          price_out_usd_per_mtoken: 10.0,
          bid_usd: 0.015,
          expires_at: "2026-05-20T13:00:00Z",
          signature: "stub",
        },
        pricingSnapshot: PRICING_SNAPSHOT,
      });
      await store.recordBidResponse({
        taskId,
        response: {
          task_id: taskId,
          agent_id: "aws-nova",
          tier: "frontier",
          model_family: "nova",
          model_id: "amazon.nova-pro",
          est_input_tokens: 4000,
          est_output_tokens: 1000,
          price_in_usd_per_mtoken: 0.8,
          price_out_usd_per_mtoken: 3.2,
          bid_usd: 0.0064,
          expires_at: "2026-05-20T13:00:00Z",
          signature: "stub",
        },
        pricingSnapshot: PRICING_SNAPSHOT,
      });

      // Vickrey: lowest bid wins, second-lowest is the price.
      await store.awardTask({
        taskId,
        winnerAgentId: "aws-nova",
        auctionPriceUsd: 0.015,
        winningBidUsd: 0.0064,
      });
      await store.markExecuting(taskId);
      await store.completeTask({
        taskId,
        result: {
          task_id: taskId,
          agent_id: "aws-nova",
          output: "summary",
          actual_usage: { input_tokens: 4100, output_tokens: 950 },
        },
      });
    });

    const app = createApp({ store, runner });

    const createRes = await app.request("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "summarize the transcript" }),
    });
    expect(createRes.status).toBe(202);
    const created = CreateTaskResponseSchema.parse(await createRes.json());

    // Wait for the scripted auction to walk the task through its lifecycle.
    await runner.settle(created.task_id);

    const getRes = await app.request(`/tasks/${created.task_id}`);
    expect(getRes.status).toBe(200);
    const fetched = GetTaskResponseSchema.parse(await getRes.json());

    expect(fetched.status).toBe("completed");
    expect(fetched.winner_agent_id).toBe("aws-nova");
    expect(fetched.auction_price_usd).toBe(0.015);
    expect(fetched.winning_bid_usd).toBe(0.0064);
    expect(fetched.result?.output).toBe("summary");

    // Underlying ledger has both bid records.
    const bids = await store.listBids(created.task_id);
    expect(bids.map((b) => b.agent_id).sort()).toEqual(["aws-nova", "gcp-gemini"]);
  });

  it("failure path: all agents decline → task marked failed with reason", async () => {
    const store = new InMemoryLedgerStore();
    const runner = new ScriptedAuctionRunner(async (taskId: TaskId) => {
      await store.recordBidResponse({
        taskId,
        response: {
          task_id: taskId,
          agent_id: "gcp-gemini",
          status: "no_bid",
          reason: "context_overflow",
        },
        pricingSnapshot: PRICING_SNAPSHOT,
      });
      await store.failTask({
        taskId,
        reason: "all agents declined: context_overflow",
      });
    });

    const app = createApp({ store, runner });
    const createRes = await app.request("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "huge task" }),
    });
    const created = CreateTaskResponseSchema.parse(await createRes.json());
    await runner.settle(created.task_id);

    const getRes = await app.request(`/tasks/${created.task_id}`);
    const fetched = GetTaskResponseSchema.parse(await getRes.json());
    expect(fetched.status).toBe("failed");
    expect(fetched.failure_reason).toContain("context_overflow");
  });
});

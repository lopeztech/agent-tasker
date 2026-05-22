import { describe, expect, it } from "vitest";
import type { AgentId, Bid, BidResponse } from "@agent-tasker/protocol";
import { collectBidResponsesAdaptive } from "../../src/auction/http-runner.js";

function bidFor(agentId: AgentId, bidUsd: number): Bid {
  return {
    task_id: "task-adaptive",
    agent_id: agentId,
    tier: "frontier",
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

function delayedResponse(ms: number, response: BidResponse): Promise<BidResponse> {
  return new Promise((resolve) => setTimeout(() => resolve(response), ms));
}

describe("collectBidResponsesAdaptive", () => {
  it("extends the bid window when at least two real bids land in the initial window", async () => {
    const responses = await collectBidResponsesAdaptive({
      taskId: "task-adaptive",
      totalTimeoutMs: 90,
      initialWaitMs: 20,
      extensionMs: 50,
      pending: [
        { agentId: "gcp-gemini", promise: delayedResponse(1, bidFor("gcp-gemini", 0.03)) },
        { agentId: "aws-nova", promise: delayedResponse(5, bidFor("aws-nova", 0.04)) },
        { agentId: "azure-gpt", promise: delayedResponse(35, bidFor("azure-gpt", 0.02)) },
      ],
    });

    expect(responses.map((response) => response.agent_id)).toEqual([
      "gcp-gemini",
      "aws-nova",
      "azure-gpt",
    ]);
    expect(responses.every((response) => !("status" in response))).toBe(true);
  });

  it("does not extend when fewer than two real bids have landed", async () => {
    const responses = await collectBidResponsesAdaptive({
      taskId: "task-adaptive",
      totalTimeoutMs: 90,
      initialWaitMs: 10,
      extensionMs: 50,
      pending: [
        { agentId: "gcp-gemini", promise: delayedResponse(1, bidFor("gcp-gemini", 0.03)) },
        { agentId: "aws-nova", promise: delayedResponse(35, bidFor("aws-nova", 0.02)) },
      ],
    });

    expect(responses[0]).toMatchObject({ agent_id: "gcp-gemini", bid_usd: 0.03 });
    expect(responses[1]).toMatchObject({
      agent_id: "aws-nova",
      status: "no_bid",
      reason: "internal_error",
    });
  });
});

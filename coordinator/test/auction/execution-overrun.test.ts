import { describe, expect, it } from "vitest";
import type { AgentId, Bid, Result } from "@agent-tasker/protocol";
import {
  EXECUTION_OVERRUN_MULTIPLIER,
  computeActualUsdFromBidPrices,
  enforceExecutionOverrunCap,
} from "../../src/auction/http-runner.js";

function bidFor(agentId: AgentId, bidUsd: number): Bid {
  return {
    task_id: "task-overrun",
    agent_id: agentId,
    tier: "frontier",
    model_family: agentId.startsWith("gcp") ? "gemini" : agentId.startsWith("aws") ? "nova" : "gpt",
    model_id: "stub-model",
    est_input_tokens: 4000,
    est_output_tokens: 1000,
    price_in_usd_per_mtoken: 1,
    price_out_usd_per_mtoken: 2,
    bid_usd: bidUsd,
    expires_at: "2026-05-21T01:00:00Z",
    signature: "stub",
  };
}

function resultWithUsage(inputTokens: number, outputTokens: number): Result {
  return {
    task_id: "task-overrun",
    agent_id: "gcp-gemini",
    output: "summary",
    actual_usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}

describe("execution overrun cap", () => {
  it("computes actual USD using the winner bid's prices", () => {
    expect(
      computeActualUsdFromBidPrices(bidFor("gcp-gemini", 0.02), resultWithUsage(1000, 2000)),
    ).toBe(0.005);
  });

  it("allows actual cost at exactly 10x the winning bid", () => {
    const bid = bidFor("gcp-gemini", 0.001);
    const result = resultWithUsage(10_000, 0);

    expect(() => enforceExecutionOverrunCap(bid, result)).not.toThrow();
    expect(computeActualUsdFromBidPrices(bid, result)).toBe(
      bid.bid_usd * EXECUTION_OVERRUN_MULTIPLIER,
    );
  });

  it("throws when actual cost exceeds 10x the winning bid", () => {
    const bid = bidFor("gcp-gemini", 0.001);
    const result = resultWithUsage(10_001, 0);

    expect(() => enforceExecutionOverrunCap(bid, result)).toThrow(/execution overrun exceeded 10x/);
  });
});

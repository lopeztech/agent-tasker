import { describe, expect, it } from "vitest";
import type { AgentId, Bid } from "@agent-tasker/protocol";
import { selectVickreyAward } from "../../src/auction/http-runner.js";

function bidFor(agentId: AgentId, bidUsd: number): Bid {
  return {
    task_id: "task-vickrey",
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

describe("selectVickreyAward", () => {
  it("selects the lowest bid and prices at the second-lowest bid", () => {
    const award = selectVickreyAward([
      bidFor("gcp-gemini", 0.02),
      bidFor("aws-nova", 0.0064),
      bidFor("azure-gpt", 0.04),
    ]);

    expect(award.winner.agent_id).toBe("aws-nova");
    expect(award.winningBidUsd).toBe(0.0064);
    expect(award.auctionPriceUsd).toBe(0.02);
  });

  it("uses the winner's own bid as the price when there is only one bidder", () => {
    const award = selectVickreyAward([bidFor("gcp-gemini", 0.02)]);

    expect(award.winner.agent_id).toBe("gcp-gemini");
    expect(award.winningBidUsd).toBe(0.02);
    expect(award.auctionPriceUsd).toBe(0.02);
  });

  it("does not mutate caller-owned bid ordering", () => {
    const bids = [
      bidFor("azure-gpt", 0.04),
      bidFor("gcp-gemini", 0.02),
      bidFor("aws-nova", 0.0064),
    ];

    selectVickreyAward(bids);

    expect(bids.map((bid) => bid.agent_id)).toEqual(["azure-gpt", "gcp-gemini", "aws-nova"]);
  });

  it("rejects an empty bid list", () => {
    expect(() => selectVickreyAward([])).toThrow(/at least one bid/);
  });
});

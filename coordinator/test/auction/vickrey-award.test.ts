import { describe, expect, it } from "vitest";
import type { AgentId, Bid, Tier } from "@agent-tasker/protocol";
import {
  bidAccuracyMultiplier,
  filterBidsByMinTier,
  selectVickreyAward,
} from "../../src/auction/http-runner.js";

function bidFor(agentId: AgentId, bidUsd: number, tier: Tier = "frontier"): Bid {
  return {
    task_id: "task-vickrey",
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

describe("filterBidsByMinTier", () => {
  it("keeps every bid when no minimum tier is requested", () => {
    const bids = [
      bidFor("gcp-gemini", 0.01, "small"),
      bidFor("aws-nova", 0.02, "medium"),
      bidFor("azure-gpt", 0.03, "frontier"),
    ];

    expect(filterBidsByMinTier(bids, undefined).map((bid) => bid.agent_id)).toEqual([
      "gcp-gemini",
      "aws-nova",
      "azure-gpt",
    ]);
  });

  it("excludes bids below the requested minimum tier before scoring", () => {
    const bids = [
      bidFor("gcp-gemini", 0.01, "small"),
      bidFor("aws-nova", 0.02, "medium"),
      bidFor("azure-gpt", 0.03, "frontier"),
    ];

    expect(filterBidsByMinTier(bids, "medium").map((bid) => bid.agent_id)).toEqual([
      "aws-nova",
      "azure-gpt",
    ]);
    expect(filterBidsByMinTier(bids, "frontier").map((bid) => bid.agent_id)).toEqual(["azure-gpt"]);
  });
});

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
    expect(award.scoreAdjustedWinningBidUsd).toBe(0.0064);
    expect(award.scoreAdjustedAuctionPriceUsd).toBe(0.02);
  });

  it("uses the winner's own bid as the price when there is only one bidder", () => {
    const award = selectVickreyAward([bidFor("gcp-gemini", 0.02)]);

    expect(award.winner.agent_id).toBe("gcp-gemini");
    expect(award.winningBidUsd).toBe(0.02);
    expect(award.auctionPriceUsd).toBe(0.02);
  });

  it("breaks tied bids by lowest historical MAPE", () => {
    const award = selectVickreyAward(
      [bidFor("gcp-gemini", 0.02), bidFor("aws-nova", 0.02), bidFor("azure-gpt", 0.04)],
      {
        "gcp-gemini": { mape: 0.18, settledTaskCount: 10 },
        "aws-nova": { mape: 0.08, settledTaskCount: 10 },
      },
    );

    expect(award.winner.agent_id).toBe("aws-nova");
    expect(award.winningBidUsd).toBe(0.02);
    expect(award.auctionPriceUsd).toBe(0.02);
  });

  it("uses historical MAPE only after bid_usd ties", () => {
    const award = selectVickreyAward([bidFor("gcp-gemini", 0.01), bidFor("aws-nova", 0.02)], {
      "gcp-gemini": { mape: 0.5, settledTaskCount: 10 },
      "aws-nova": { mape: 0.01, settledTaskCount: 10 },
    });

    expect(award.winner.agent_id).toBe("gcp-gemini");
    expect(award.winningBidUsd).toBe(0.01);
    expect(award.auctionPriceUsd).toBe(0.02);
  });

  it("score-weights bids by MAPE after 100 settled tasks", () => {
    const award = selectVickreyAward(
      [bidFor("gcp-gemini", 0.019), bidFor("aws-nova", 0.02), bidFor("azure-gpt", 0.04)],
      {
        "gcp-gemini": { mape: 0.2, settledTaskCount: 100 },
        "aws-nova": { mape: 0.01, settledTaskCount: 100 },
      },
    );

    expect(award.winner.agent_id).toBe("aws-nova");
    expect(award.winningBidUsd).toBe(0.02);
    expect(award.auctionPriceUsd).toBe(0.019);
    expect(award.scoreAdjustedWinningBidUsd).toBeCloseTo(0.0202);
    expect(award.scoreAdjustedAuctionPriceUsd).toBeCloseTo(0.0228);
  });

  it("does not score-weight agents before 100 settled tasks", () => {
    const award = selectVickreyAward([bidFor("gcp-gemini", 0.019), bidFor("aws-nova", 0.02)], {
      "gcp-gemini": { mape: 0.2, settledTaskCount: 99 },
      "aws-nova": { mape: 0.01, settledTaskCount: 100 },
    });

    expect(award.winner.agent_id).toBe("gcp-gemini");
    expect(award.scoreAdjustedWinningBidUsd).toBe(0.019);
    expect(award.scoreAdjustedAuctionPriceUsd).toBeCloseTo(0.0202);
  });

  it("falls back to random selection among tied cold-start agents", () => {
    const award = selectVickreyAward(
      [bidFor("gcp-gemini", 0.02), bidFor("aws-nova", 0.02), bidFor("azure-gpt", 0.04)],
      {
        "gcp-gemini": { mape: 0.18, settledTaskCount: 9 },
        "aws-nova": { mape: 0.08, settledTaskCount: 9 },
      },
      () => 0.75,
    );

    expect(award.winner.agent_id).toBe("aws-nova");
    expect(award.winningBidUsd).toBe(0.02);
    expect(award.auctionPriceUsd).toBe(0.02);
  });

  it("prefers tied cold-start agents over mature MAPE candidates", () => {
    const award = selectVickreyAward(
      [bidFor("gcp-gemini", 0.02), bidFor("aws-nova", 0.02), bidFor("azure-gpt", 0.04)],
      {
        "gcp-gemini": { mape: 0.18, settledTaskCount: 9 },
        "aws-nova": { mape: 0.08, settledTaskCount: 10 },
      },
      () => 0,
    );

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

describe("bidAccuracyMultiplier", () => {
  it("is neutral before the score-weighting sample threshold", () => {
    expect(bidAccuracyMultiplier(undefined)).toBe(1);
    expect(bidAccuracyMultiplier({ mape: 0.5, settledTaskCount: 99 })).toBe(1);
  });

  it("adds MAPE to the bid multiplier once enough history exists", () => {
    expect(bidAccuracyMultiplier({ mape: 0.125, settledTaskCount: 100 })).toBe(1.125);
  });
});

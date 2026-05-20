import { describe, expect, it } from "vitest";
import type { AnnounceRequest, PricingEntry } from "@agent-tasker/protocol";
import { handleBid } from "../../src/bid/handler.js";
import type { BidEstimator } from "../../src/bid/estimator.js";

const SPEC: AnnounceRequest["spec"] = { prompt: "summarize the transcript" };

const PRICING: PricingEntry = {
  model_id: "gemini-2-5-pro",
  price_in_usd_per_mtoken: 1.25,
  price_out_usd_per_mtoken: 10.0,
  effective_date: "2026-05-15",
};

function stubEstimator(input_tokens: number, output_tokens: number): BidEstimator {
  return {
    async estimate() {
      return { input_tokens, output_tokens };
    },
  };
}

function throwingEstimator(message: string): BidEstimator {
  return {
    async estimate() {
      throw new Error(message);
    },
  };
}

describe("handleBid", () => {
  it("returns a Bid with the right shape and computed USD when estimation succeeds", async () => {
    const fixed = new Date("2026-05-21T12:00:00Z");
    const res = await handleBid(
      { task_id: "task-1", spec: SPEC },
      {
        estimator: stubEstimator(4000, 1000),
        pricing: PRICING,
        now: () => fixed,
      },
    );

    if ("status" in res) throw new Error(`expected bid, got no_bid: ${res.reason}`);

    expect(res.task_id).toBe("task-1");
    expect(res.agent_id).toBe("gcp-gemini");
    expect(res.tier).toBe("frontier");
    expect(res.model_family).toBe("gemini");
    expect(res.model_id).toBe("gemini-2-5-pro");
    expect(res.est_input_tokens).toBe(4000);
    expect(res.est_output_tokens).toBe(1000);
    expect(res.price_in_usd_per_mtoken).toBe(1.25);
    expect(res.price_out_usd_per_mtoken).toBe(10.0);
    // 4000 / 1e6 * 1.25 + 1000 / 1e6 * 10 = 0.005 + 0.01 = 0.015
    expect(res.bid_usd).toBeCloseTo(0.015, 10);
    // expires_at = now + 60s
    expect(res.expires_at).toBe("2026-05-21T12:01:00.000Z");
    expect(res.signature).toBe("stub-signature");
  });

  it("uses a custom signer when provided", async () => {
    const res = await handleBid(
      { task_id: "task-sign", spec: SPEC },
      {
        estimator: stubEstimator(100, 50),
        pricing: PRICING,
        sign: (id) => `signed:${id}`,
      },
    );
    if ("status" in res) throw new Error("expected bid");
    expect(res.signature).toBe("signed:task-sign");
  });

  it("declines with internal_error when the estimator throws", async () => {
    const res = await handleBid(
      { task_id: "task-fail", spec: SPEC },
      {
        estimator: throwingEstimator("Vertex unavailable"),
        pricing: PRICING,
      },
    );
    if (!("status" in res)) throw new Error("expected no_bid");
    expect(res.status).toBe("no_bid");
    expect(res.reason).toBe("internal_error");
    expect(res.agent_id).toBe("gcp-gemini");
    expect(res.task_id).toBe("task-fail");
  });

  it("propagates minimum-tier spec field into the estimator without changing the bid envelope's tier", async () => {
    // gcp-gemini always declares frontier (per CLAUDE.md tier mapping).
    // The estimator may use min_tier to refine its estimate, but the bid's
    // tier field is fixed.
    let seenSpec: AnnounceRequest["spec"] | undefined;
    const estimator: BidEstimator = {
      async estimate(spec) {
        seenSpec = spec;
        return { input_tokens: 200, output_tokens: 50 };
      },
    };
    const res = await handleBid(
      { task_id: "t", spec: { prompt: "p", min_tier: "small" } },
      { estimator, pricing: PRICING },
    );
    if ("status" in res) throw new Error("expected bid");
    expect(seenSpec?.min_tier).toBe("small");
    expect(res.tier).toBe("frontier");
  });
});

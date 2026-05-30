import {
  computeBidUsd,
  type AnnounceRequest,
  type Bid,
  type BidResponse,
  type PricingEntry,
} from "@agent-tasker/protocol";
import type { BidEstimator } from "./estimator.js";

export const AGENT_ID = "aws-nova" as const;
export const EXECUTION_MODEL_ID = "amazon.nova-pro-v1:0";
export const EXECUTION_MODEL_FAMILY = "nova" as const;
export const EXECUTION_TIER = "frontier" as const;

const BID_TTL_MS = 60_000;

export interface BidHandlerDeps {
  estimator: BidEstimator;
  pricing: PricingEntry;
  now?: () => Date;
  sign?: (taskId: string) => string;
}

export async function handleBid(req: AnnounceRequest, deps: BidHandlerDeps): Promise<BidResponse> {
  const now = deps.now?.() ?? new Date();
  try {
    const { input_tokens, output_tokens } = await deps.estimator.estimate(req.spec);
    const bidUsd = computeBidUsd({
      est_input_tokens: input_tokens,
      est_output_tokens: output_tokens,
      price_in_usd_per_mtoken: deps.pricing.price_in_usd_per_mtoken,
      price_out_usd_per_mtoken: deps.pricing.price_out_usd_per_mtoken,
    });

    const bid: Bid = {
      task_id: req.task_id,
      agent_id: AGENT_ID,
      tier: EXECUTION_TIER,
      model_family: EXECUTION_MODEL_FAMILY,
      model_id: EXECUTION_MODEL_ID,
      est_input_tokens: input_tokens,
      est_output_tokens: output_tokens,
      price_in_usd_per_mtoken: deps.pricing.price_in_usd_per_mtoken,
      price_out_usd_per_mtoken: deps.pricing.price_out_usd_per_mtoken,
      bid_usd: bidUsd,
      expires_at: new Date(now.getTime() + BID_TTL_MS).toISOString(),
      signature: deps.sign?.(req.task_id) ?? "stub-signature",
    };
    return bid;
  } catch (err) {
    void err;
    return {
      task_id: req.task_id,
      agent_id: AGENT_ID,
      status: "no_bid",
      reason: "internal_error",
    };
  }
}

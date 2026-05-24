import type { Bid, Result } from "@agent-tasker/protocol";
import type { AgentMapeRollup } from "./types.js";

export interface BidAccuracySample {
  bidUsd: number;
  actualUsd: number;
  absolutePercentageError: number;
  signedPercentageError: number;
}

export function computeBidAccuracySample(bid: Bid, result: Result): BidAccuracySample | null {
  if (bid.bid_usd <= 0) return null;
  const actualUsd = computeActualUsd(bid, result);
  const signedPercentageError = (actualUsd - bid.bid_usd) / bid.bid_usd;
  return {
    bidUsd: bid.bid_usd,
    actualUsd,
    absolutePercentageError: Math.abs(signedPercentageError),
    signedPercentageError,
  };
}

export function applyBidAccuracySample(
  previous: AgentMapeRollup | null,
  args: {
    agentId: Bid["agent_id"];
    taskId: Bid["task_id"];
    updatedAt: string;
    sample: BidAccuracySample;
  },
): AgentMapeRollup {
  const settledTaskCount = (previous?.settled_task_count ?? 0) + 1;
  const absolutePercentageErrorSum =
    (previous?.absolute_percentage_error_sum ?? 0) + args.sample.absolutePercentageError;
  const signedPercentageErrorSum =
    (previous?.signed_percentage_error_sum ?? 0) + args.sample.signedPercentageError;

  return {
    agent_id: args.agentId,
    updated_at: args.updatedAt,
    settled_task_count: settledTaskCount,
    absolute_percentage_error_sum: absolutePercentageErrorSum,
    signed_percentage_error_sum: signedPercentageErrorSum,
    mape: absolutePercentageErrorSum / settledTaskCount,
    mean_signed_percentage_error: signedPercentageErrorSum / settledTaskCount,
    last_task_id: args.taskId,
    last_bid_usd: args.sample.bidUsd,
    last_actual_usd: args.sample.actualUsd,
    last_absolute_percentage_error: args.sample.absolutePercentageError,
    last_signed_percentage_error: args.sample.signedPercentageError,
  };
}

function computeActualUsd(bid: Bid, result: Result): number {
  return (
    (result.actual_usage.input_tokens / 1_000_000) * bid.price_in_usd_per_mtoken +
    (result.actual_usage.output_tokens / 1_000_000) * bid.price_out_usd_per_mtoken
  );
}

import { isNoBid, type BidResponse, type NoBidReason } from "@agent-tasker/protocol";
import type { AgentDeclineRollup } from "./types.js";

const REASONS = ["context_overflow", "policy", "capability", "internal_error"] as const;

type ReasonCounts = AgentDeclineRollup["decline_reasons"];

export function applyDeclineRollupUpdate(
  previousRollup: AgentDeclineRollup | null,
  args: {
    previousResponse: BidResponse | undefined;
    nextResponse: BidResponse;
    updatedAt: string;
  },
): AgentDeclineRollup {
  const counts = previousRollup?.decline_reasons
    ? { ...previousRollup.decline_reasons }
    : emptyReasonCounts();
  let bidResponseCount = previousRollup?.bid_response_count ?? 0;
  let bidCount = previousRollup?.bid_count ?? 0;
  let declineCount = previousRollup?.decline_count ?? 0;

  if (args.previousResponse) {
    const previousImpact = responseImpact(args.previousResponse);
    bidResponseCount -= previousImpact.bidResponseCount;
    bidCount -= previousImpact.bidCount;
    declineCount -= previousImpact.declineCount;
    if (previousImpact.reason) counts[previousImpact.reason] -= 1;
  }

  const nextImpact = responseImpact(args.nextResponse);
  bidResponseCount += nextImpact.bidResponseCount;
  bidCount += nextImpact.bidCount;
  declineCount += nextImpact.declineCount;
  if (nextImpact.reason) counts[nextImpact.reason] += 1;

  return {
    agent_id: args.nextResponse.agent_id,
    updated_at: args.updatedAt,
    bid_response_count: bidResponseCount,
    bid_count: bidCount,
    decline_count: declineCount,
    decline_rate: bidResponseCount === 0 ? 0 : declineCount / bidResponseCount,
    decline_reasons: counts,
    last_task_id: args.nextResponse.task_id,
    last_response_kind: isNoBid(args.nextResponse) ? "no_bid" : "bid",
    last_no_bid_reason: isNoBid(args.nextResponse) ? args.nextResponse.reason : undefined,
  };
}

function responseImpact(response: BidResponse): {
  bidResponseCount: number;
  bidCount: number;
  declineCount: number;
  reason?: NoBidReason;
} {
  if (isNoBid(response)) {
    return {
      bidResponseCount: 1,
      bidCount: 0,
      declineCount: 1,
      reason: response.reason,
    };
  }
  return {
    bidResponseCount: 1,
    bidCount: 1,
    declineCount: 0,
  };
}

function emptyReasonCounts(): ReasonCounts {
  return Object.fromEntries(REASONS.map((reason) => [reason, 0])) as ReasonCounts;
}

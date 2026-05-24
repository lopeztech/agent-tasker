import type { Bid, Tier } from "@agent-tasker/protocol";
import type { AgentWinRateRollup } from "./types.js";

const TIERS = ["small", "medium", "frontier"] as const satisfies readonly Tier[];

export function applyWinRateBidUpdate(
  previousRollup: AgentWinRateRollup | null,
  args: {
    previousBid: Bid | undefined;
    nextBid: Bid;
    updatedAt: string;
  },
): AgentWinRateRollup {
  const rollup = cloneRollup(previousRollup, args.nextBid.agent_id);

  if (args.previousBid) {
    rollup.bid_count -= 1;
    rollup.tiers[args.previousBid.tier].bid_count -= 1;
  }

  rollup.bid_count += 1;
  rollup.tiers[args.nextBid.tier].bid_count += 1;
  rollup.updated_at = args.updatedAt;
  rollup.last_task_id = args.nextBid.task_id;
  rollup.last_event = "bid";
  rollup.last_tier = args.nextBid.tier;
  return withRates(rollup);
}

export function applyWinRateBidRemoval(
  previousRollup: AgentWinRateRollup | null,
  args: {
    previousBid: Bid;
    updatedAt: string;
  },
): AgentWinRateRollup {
  const rollup = cloneRollup(previousRollup, args.previousBid.agent_id);
  rollup.bid_count -= 1;
  rollup.tiers[args.previousBid.tier].bid_count -= 1;
  rollup.updated_at = args.updatedAt;
  rollup.last_task_id = args.previousBid.task_id;
  rollup.last_event = "bid";
  rollup.last_tier = args.previousBid.tier;
  return withRates(rollup);
}

export function applyWinRateWinUpdate(
  previousRollup: AgentWinRateRollup | null,
  args: {
    winningBid: Bid;
    updatedAt: string;
  },
): AgentWinRateRollup {
  const rollup = cloneRollup(previousRollup, args.winningBid.agent_id);
  rollup.win_count += 1;
  rollup.tiers[args.winningBid.tier].win_count += 1;
  rollup.updated_at = args.updatedAt;
  rollup.last_task_id = args.winningBid.task_id;
  rollup.last_event = "win";
  rollup.last_tier = args.winningBid.tier;
  return withRates(rollup);
}

function cloneRollup(
  rollup: AgentWinRateRollup | null,
  agentId: Bid["agent_id"],
): AgentWinRateRollup {
  if (rollup) return structuredClone(rollup);
  return {
    agent_id: agentId,
    updated_at: "1970-01-01T00:00:00.000Z",
    bid_count: 0,
    win_count: 0,
    win_rate: 0,
    tiers: Object.fromEntries(
      TIERS.map((tier) => [tier, { bid_count: 0, win_count: 0, win_rate: 0 }]),
    ) as AgentWinRateRollup["tiers"],
    last_task_id: "",
    last_event: "bid",
    last_tier: "small",
  };
}

function withRates(rollup: AgentWinRateRollup): AgentWinRateRollup {
  rollup.win_rate = rate(rollup.win_count, rollup.bid_count);
  for (const tier of TIERS) {
    const stats = rollup.tiers[tier];
    stats.win_rate = rate(stats.win_count, stats.bid_count);
  }
  return rollup;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

import { isNoBid, type AgentId, type Bid, type NoBid, type TaskId } from "@agent-tasker/protocol";
import { computeActualUsdFromBidPrices } from "../auction/http-runner.js";
import type { LedgerStore } from "./store.js";
import type { BidRecord, TaskRecord } from "./types.js";

export interface LedgerReplay {
  task: TaskRecord;
  bids: ReplayBid[];
  no_bids: ReplayNoBid[];
  award: ReplayAward | null;
  settlement: ReplaySettlement | null;
}

export interface ReplayBid {
  agent_id: AgentId;
  bid_usd: number;
  tier: Bid["tier"];
  model_family: Bid["model_family"];
  model_id: string;
  pricing_snapshot: BidRecord["pricing_snapshot"];
  est_input_tokens: number;
  est_output_tokens: number;
}

export interface ReplayNoBid {
  agent_id: AgentId;
  reason: Exclude<BidRecord["no_bid_reason"], undefined>;
}

export interface ReplayAward {
  winner_agent_id: AgentId;
  winning_bid_usd: number;
  auction_price_usd: number;
}

export interface ReplaySettlement {
  winner_agent_id: AgentId;
  output: string;
  actual_usage: NonNullable<TaskRecord["result"]>["actual_usage"];
  actual_usd_from_bid_prices: number | null;
  bid_error_usd: number | null;
  absolute_percentage_error: number | null;
}

export class LedgerReplayTaskNotFoundError extends Error {
  constructor(taskId: TaskId) {
    super(`cannot replay missing task ${taskId}`);
    this.name = "LedgerReplayTaskNotFoundError";
  }
}

export async function replayTaskFromLedger(
  store: LedgerStore,
  taskId: TaskId,
): Promise<LedgerReplay> {
  const task = await store.getTask(taskId);
  if (!task) throw new LedgerReplayTaskNotFoundError(taskId);

  const bidRecords = await store.listBids(taskId);
  const bids = bidRecords.filter(isBidRecord).map(toReplayBid);
  const noBids = bidRecords.filter(isNoBidRecord).map(toReplayNoBid);
  const winningBid = findWinningBidRecord(bidRecords, task.winner_agent_id);

  return {
    task,
    bids,
    no_bids: noBids,
    award: toReplayAward(task),
    settlement: toReplaySettlement(task, winningBid),
  };
}

function isBidRecord(record: BidRecord): record is BidRecord & { response: Bid } {
  return !isNoBid(record.response);
}

function isNoBidRecord(record: BidRecord): record is BidRecord & { response: NoBid } {
  return isNoBid(record.response);
}

function findWinningBidRecord(
  bidRecords: BidRecord[],
  winnerAgentId: AgentId | undefined,
): (BidRecord & { response: Bid }) | undefined {
  if (!winnerAgentId) return undefined;
  return bidRecords.find(
    (record): record is BidRecord & { response: Bid } =>
      record.agent_id === winnerAgentId && isBidRecord(record),
  );
}

function toReplayBid(record: BidRecord & { response: Bid }): ReplayBid {
  return {
    agent_id: record.agent_id,
    bid_usd: record.response.bid_usd,
    tier: record.response.tier,
    model_family: record.response.model_family,
    model_id: record.response.model_id,
    pricing_snapshot: record.pricing_snapshot,
    est_input_tokens: record.response.est_input_tokens,
    est_output_tokens: record.response.est_output_tokens,
  };
}

function toReplayNoBid(record: BidRecord & { response: NoBid }): ReplayNoBid {
  return {
    agent_id: record.agent_id,
    reason: record.response.reason,
  };
}

function toReplayAward(task: TaskRecord): ReplayAward | null {
  if (
    !task.winner_agent_id ||
    task.winning_bid_usd === undefined ||
    task.auction_price_usd === undefined
  ) {
    return null;
  }
  return {
    winner_agent_id: task.winner_agent_id,
    winning_bid_usd: task.winning_bid_usd,
    auction_price_usd: task.auction_price_usd,
  };
}

function toReplaySettlement(
  task: TaskRecord,
  winningBid: (BidRecord & { response: Bid }) | undefined,
): ReplaySettlement | null {
  if (!task.winner_agent_id || !task.result) return null;

  const actualUsd = winningBid
    ? computeActualUsdFromBidPrices(winningBid.response, task.result)
    : null;
  const bidErrorUsd = actualUsd === null ? null : actualUsd - winningBid!.response.bid_usd;
  return {
    winner_agent_id: task.winner_agent_id,
    output: task.result.output,
    actual_usage: task.result.actual_usage,
    actual_usd_from_bid_prices: actualUsd,
    bid_error_usd: bidErrorUsd,
    absolute_percentage_error:
      actualUsd === null || winningBid!.response.bid_usd === 0
        ? null
        : Math.abs(bidErrorUsd! / winningBid!.response.bid_usd),
  };
}

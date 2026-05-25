import { isNoBid, type AgentId, type TaskId } from "@agent-tasker/protocol";
import {
  InvalidTransitionError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
  canTransition,
} from "../auction/state-machine.js";
import type {
  AwardTaskInput,
  CompleteTaskInput,
  CreateTaskInput,
  FailTaskInput,
  LedgerStore,
  RecordBidResponseInput,
} from "./store.js";
import { applyDeclineRollupUpdate } from "./declines.js";
import { applyBidAccuracySample, computeBidAccuracySample } from "./mape.js";
import { buildResultRecord } from "./results.js";
import type {
  AgentDeclineRollup,
  AgentMapeRollup,
  AgentWinRateRollup,
  BidRecord,
  ResultRecord,
  TaskRecord,
} from "./types.js";
import {
  applyWinRateBidRemoval,
  applyWinRateBidUpdate,
  applyWinRateWinUpdate,
} from "./win-rates.js";
import {
  recordBidAccuracySample,
  recordBidDeltas,
  recordWin,
  type AgentBidAccuracyMetric,
  type AgentTierMetricDelta,
} from "../observability/market-metrics.js";

// In-memory ledger backing — single-process, single-test usage. Maps are
// keyed by taskId for tasks and by `${taskId}:${agent_id}` for bids.
// Returned objects are defensive-cloned so a caller can't mutate stored
// state by holding a reference (which Firestore-backed callers can't do
// either).
export class InMemoryLedgerStore implements LedgerStore {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly bids = new Map<string, BidRecord>();
  private readonly results = new Map<string, ResultRecord>();
  private readonly mapeRollups = new Map<AgentId, AgentMapeRollup>();
  private readonly declineRollups = new Map<AgentId, AgentDeclineRollup>();
  private readonly winRateRollups = new Map<AgentId, AgentWinRateRollup>();

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    if (this.tasks.has(input.taskId)) {
      throw new TaskAlreadyExistsError(input.taskId);
    }
    const now = nowIso(input.now);
    const record: TaskRecord = {
      task_id: input.taskId,
      status: "bidding",
      spec: input.spec,
      created_at: now,
      updated_at: now,
    };
    this.tasks.set(input.taskId, record);
    return clone(record);
  }

  async getTask(taskId: TaskId): Promise<TaskRecord | null> {
    const record = this.tasks.get(taskId);
    return record ? clone(record) : null;
  }

  async recordBidResponse(input: RecordBidResponseInput): Promise<BidRecord> {
    const task = this.requireTask(input.taskId);
    // Bid responses are only meaningful during the bidding window; reject
    // late writes loudly rather than silently dropping data.
    if (task.status !== "bidding") {
      throw new InvalidTransitionError(input.taskId, task.status, "bidding");
    }
    const record: BidRecord = {
      task_id: input.taskId,
      agent_id: input.response.agent_id,
      timestamp: nowIso(input.now),
      phase: "bid",
      response_kind: isNoBid(input.response) ? "no_bid" : "bid",
      no_bid_reason: isNoBid(input.response) ? input.response.reason : undefined,
      mape_eligible: !isNoBid(input.response),
      response: input.response,
      pricing_snapshot: input.pricingSnapshot,
    };
    const previous = this.bids.get(bidKey(input.taskId, input.response.agent_id));
    this.bids.set(bidKey(input.taskId, input.response.agent_id), record);
    this.writeDeclineRollup(previous, record);
    this.writeWinRateBidRollup(previous, record);
    recordBidDeltas(bidMetricDeltas(previous, record));
    return clone(record);
  }

  async listBids(taskId: TaskId): Promise<BidRecord[]> {
    const prefix = `${taskId}:`;
    const out: BidRecord[] = [];
    for (const [key, record] of this.bids) {
      if (key.startsWith(prefix)) out.push(clone(record));
    }
    out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return out;
  }

  async listResults(taskId: TaskId): Promise<ResultRecord[]> {
    const prefix = `${taskId}:`;
    const out: ResultRecord[] = [];
    for (const [key, record] of this.results) {
      if (key.startsWith(prefix)) out.push(clone(record));
    }
    out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return out;
  }

  async getAgentMapeRollup(agentId: AgentId): Promise<AgentMapeRollup | null> {
    const record = this.mapeRollups.get(agentId);
    return record ? clone(record) : null;
  }

  async getAgentDeclineRollup(agentId: AgentId): Promise<AgentDeclineRollup | null> {
    const record = this.declineRollups.get(agentId);
    return record ? clone(record) : null;
  }

  async getAgentWinRateRollup(agentId: AgentId): Promise<AgentWinRateRollup | null> {
    const record = this.winRateRollups.get(agentId);
    return record ? clone(record) : null;
  }

  async awardTask(input: AwardTaskInput): Promise<TaskRecord> {
    const task = this.requireTask(input.taskId);

    // Idempotent reassertion: same winner + same prices on an already-awarded
    // task returns the existing record unchanged.
    if (
      task.status === "awarded" &&
      task.winner_agent_id === input.winnerAgentId &&
      task.auction_price_usd === input.auctionPriceUsd &&
      task.winning_bid_usd === input.winningBidUsd
    ) {
      return clone(task);
    }

    if (!canTransition(task.status, "awarded")) {
      throw new InvalidTransitionError(input.taskId, task.status, "awarded");
    }

    const next: TaskRecord = {
      ...task,
      status: "awarded",
      updated_at: nowIso(input.now),
      winner_agent_id: input.winnerAgentId,
      auction_price_usd: input.auctionPriceUsd,
      winning_bid_usd: input.winningBidUsd,
    };
    this.tasks.set(input.taskId, next);
    return clone(next);
  }

  async markExecuting(taskId: TaskId, now?: Date): Promise<TaskRecord> {
    const task = this.requireTask(taskId);

    if (task.status === "executing") return clone(task);

    if (!canTransition(task.status, "executing")) {
      throw new InvalidTransitionError(taskId, task.status, "executing");
    }

    const next: TaskRecord = { ...task, status: "executing", updated_at: nowIso(now) };
    this.tasks.set(taskId, next);
    return clone(next);
  }

  async completeTask(input: CompleteTaskInput): Promise<TaskRecord> {
    const task = this.requireTask(input.taskId);

    if (task.status === "completed" && task.result && task.result.output === input.result.output) {
      this.writeResultRecord(input.taskId, task.result, task.updated_at);
      return clone(task);
    }

    if (!canTransition(task.status, "completed")) {
      throw new InvalidTransitionError(input.taskId, task.status, "completed");
    }

    const completedAt = nowIso(input.now);
    const next: TaskRecord = {
      ...task,
      status: "completed",
      updated_at: completedAt,
      result: input.result,
    };
    this.tasks.set(input.taskId, next);
    this.writeResultRecord(input.taskId, input.result, completedAt);
    const settlementMetrics = this.writeSettlementRollups(next, input.result);
    if (settlementMetrics?.win) {
      recordWin(settlementMetrics.win.agentId, settlementMetrics.win.tier);
    }
    if (settlementMetrics?.accuracy) {
      recordBidAccuracySample(settlementMetrics.accuracy);
    }
    return clone(next);
  }

  async failTask(input: FailTaskInput): Promise<TaskRecord> {
    const task = this.requireTask(input.taskId);

    if (task.status === "failed" && task.failure_reason === input.reason) {
      return clone(task);
    }

    if (!canTransition(task.status, "failed")) {
      throw new InvalidTransitionError(input.taskId, task.status, "failed");
    }

    const next: TaskRecord = {
      ...task,
      status: "failed",
      updated_at: nowIso(input.now),
      failure_reason: input.reason,
    };
    this.tasks.set(input.taskId, next);
    return clone(next);
  }

  private writeMapeRollup(
    task: TaskRecord,
    result: TaskRecord["result"],
  ): AgentBidAccuracyMetric | undefined {
    if (!task.winner_agent_id || !result) return undefined;
    const bidRecord = this.bids.get(bidKey(task.task_id, task.winner_agent_id));
    if (!bidRecord || isNoBid(bidRecord.response)) return undefined;

    const sample = computeBidAccuracySample(bidRecord.response, result);
    if (!sample) return undefined;

    const previous = this.mapeRollups.get(task.winner_agent_id) ?? null;
    this.mapeRollups.set(
      task.winner_agent_id,
      applyBidAccuracySample(previous, {
        agentId: task.winner_agent_id,
        taskId: task.task_id,
        updatedAt: task.updated_at,
        sample,
      }),
    );
    return {
      agentId: bidRecord.response.agent_id,
      tier: bidRecord.response.tier,
      sample,
    };
  }

  private writeResultRecord(taskId: TaskId, result: TaskRecord["result"], timestamp: string): void {
    if (!result) return;
    this.results.set(
      resultKey(taskId, result.agent_id),
      buildResultRecord(taskId, result, timestamp),
    );
  }

  private writeSettlementRollups(
    task: TaskRecord,
    result: TaskRecord["result"],
  ): SettlementMetricDeltas | undefined {
    const accuracy = this.writeMapeRollup(task, result);
    const win = this.writeWinRateWinRollup(task);
    if (!win) return undefined;
    if (!accuracy) return { win };
    return { win, accuracy };
  }

  private writeDeclineRollup(previous: BidRecord | undefined, next: BidRecord): void {
    const previousRollup = this.declineRollups.get(next.agent_id) ?? null;
    this.declineRollups.set(
      next.agent_id,
      applyDeclineRollupUpdate(previousRollup, {
        previousResponse: previous?.response,
        nextResponse: next.response,
        updatedAt: next.timestamp,
      }),
    );
  }

  private writeWinRateBidRollup(previous: BidRecord | undefined, next: BidRecord): void {
    const previousBid = previous && !isNoBid(previous.response) ? previous.response : undefined;
    if (isNoBid(next.response)) {
      if (!previousBid) return;
      const previousRollup = this.winRateRollups.get(next.agent_id) ?? null;
      this.winRateRollups.set(
        next.agent_id,
        applyWinRateBidRemoval(previousRollup, {
          previousBid,
          updatedAt: next.timestamp,
        }),
      );
      return;
    }

    const previousRollup = this.winRateRollups.get(next.agent_id) ?? null;
    this.winRateRollups.set(
      next.agent_id,
      applyWinRateBidUpdate(previousRollup, {
        previousBid,
        nextBid: next.response,
        updatedAt: next.timestamp,
      }),
    );
  }

  private writeWinRateWinRollup(task: TaskRecord): AgentTierMetricDelta | undefined {
    if (!task.winner_agent_id) return undefined;
    const bidRecord = this.bids.get(bidKey(task.task_id, task.winner_agent_id));
    if (!bidRecord || isNoBid(bidRecord.response)) return undefined;

    const previousRollup = this.winRateRollups.get(task.winner_agent_id) ?? null;
    this.winRateRollups.set(
      task.winner_agent_id,
      applyWinRateWinUpdate(previousRollup, {
        winningBid: bidRecord.response,
        updatedAt: task.updated_at,
      }),
    );
    return {
      agentId: bidRecord.response.agent_id,
      tier: bidRecord.response.tier,
      delta: 1,
    };
  }

  private requireTask(taskId: TaskId): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) throw new TaskNotFoundError(taskId);
    return task;
  }
}

function bidKey(taskId: TaskId, agentId: string): string {
  return `${taskId}:${agentId}`;
}

function resultKey(taskId: TaskId, agentId: string): string {
  return `${taskId}:${agentId}`;
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

// Defensive deep-clone of plain objects. Records hold only JSON-serializable
// values (strings, numbers, arrays, nested plain objects); structuredClone is
// available in Node 22 and faster than JSON round-trip.
function clone<T>(value: T): T {
  return structuredClone(value);
}

function bidMetricDeltas(
  previousBid: BidRecord | undefined,
  nextBid: BidRecord,
): AgentTierMetricDelta[] {
  const deltas: AgentTierMetricDelta[] = [];
  if (previousBid && !isNoBid(previousBid.response)) {
    deltas.push({
      agentId: previousBid.response.agent_id,
      tier: previousBid.response.tier,
      delta: -1,
    });
  }
  if (!isNoBid(nextBid.response)) {
    deltas.push({
      agentId: nextBid.response.agent_id,
      tier: nextBid.response.tier,
      delta: 1,
    });
  }
  return deltas;
}

interface SettlementMetricDeltas {
  win: AgentTierMetricDelta;
  accuracy?: AgentBidAccuracyMetric;
}

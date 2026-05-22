import { isNoBid, type TaskId } from "@agent-tasker/protocol";
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
import type { BidRecord, TaskRecord } from "./types.js";

// In-memory ledger backing — single-process, single-test usage. Maps are
// keyed by taskId for tasks and by `${taskId}:${agent_id}` for bids.
// Returned objects are defensive-cloned so a caller can't mutate stored
// state by holding a reference (which Firestore-backed callers can't do
// either).
export class InMemoryLedgerStore implements LedgerStore {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly bids = new Map<string, BidRecord>();

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
    this.bids.set(bidKey(input.taskId, input.response.agent_id), record);
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
      return clone(task);
    }

    if (!canTransition(task.status, "completed")) {
      throw new InvalidTransitionError(input.taskId, task.status, "completed");
    }

    const next: TaskRecord = {
      ...task,
      status: "completed",
      updated_at: nowIso(input.now),
      result: input.result,
    };
    this.tasks.set(input.taskId, next);
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

  private requireTask(taskId: TaskId): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) throw new TaskNotFoundError(taskId);
    return task;
  }
}

function bidKey(taskId: TaskId, agentId: string): string {
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

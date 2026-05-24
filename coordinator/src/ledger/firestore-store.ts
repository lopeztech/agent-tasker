import {
  Firestore,
  type CollectionReference,
  type DocumentReference,
  type Transaction,
} from "@google-cloud/firestore";
import { isNoBid, type AgentId, type TaskId, type TaskStatus } from "@agent-tasker/protocol";
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
import {
  AgentDeclineRollupSchema,
  AgentMapeRollupSchema,
  AgentWinRateRollupSchema,
  BidRecordSchema,
  TaskRecordSchema,
  type AgentDeclineRollup,
  type AgentMapeRollup,
  type AgentWinRateRollup,
  type BidRecord,
  type TaskRecord,
} from "./types.js";
import {
  applyWinRateBidRemoval,
  applyWinRateBidUpdate,
  applyWinRateWinUpdate,
} from "./win-rates.js";

// Production-backed ledger store. Schema validation on read defends against
// drift between deployed code and historical documents — any field rename
// or removed enum value surfaces as a Zod parse error rather than a
// silent undefined downstream.
export class FirestoreLedgerStore implements LedgerStore {
  private readonly tasksCollection: CollectionReference;
  private readonly mapeRollupsCollection: CollectionReference;
  private readonly declineRollupsCollection: CollectionReference;
  private readonly winRateRollupsCollection: CollectionReference;

  constructor(private readonly firestore: Firestore) {
    this.tasksCollection = firestore.collection("tasks");
    this.mapeRollupsCollection = firestore.collection("agent_mape_rollups");
    this.declineRollupsCollection = firestore.collection("agent_decline_rollups");
    this.winRateRollupsCollection = firestore.collection("agent_win_rate_rollups");
  }

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const ref = this.taskRef(input.taskId);
    const now = nowIso(input.now);
    const record: TaskRecord = {
      task_id: input.taskId,
      status: "bidding",
      spec: input.spec,
      created_at: now,
      updated_at: now,
    };
    try {
      await ref.create(stripUndefined(record));
    } catch (err: unknown) {
      if (isAlreadyExists(err)) throw new TaskAlreadyExistsError(input.taskId);
      throw err;
    }
    return record;
  }

  async getTask(taskId: TaskId): Promise<TaskRecord | null> {
    const snap = await this.taskRef(taskId).get();
    if (!snap.exists) return null;
    return TaskRecordSchema.parse(snap.data());
  }

  async recordBidResponse(input: RecordBidResponseInput): Promise<BidRecord> {
    const taskRef = this.taskRef(input.taskId);
    const bidRef = taskRef.collection("bids").doc(input.response.agent_id);

    return this.firestore.runTransaction(async (tx) => {
      const task = await this.readTask(tx, taskRef, input.taskId);
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
      const previousBidSnap = await tx.get(bidRef);
      const previousBid = previousBidSnap.exists
        ? BidRecordSchema.parse(previousBidSnap.data())
        : undefined;
      await this.writeBidResponseRollups(tx, previousBid, record);
      tx.set(bidRef, stripUndefined(record));
      return record;
    });
  }

  async listBids(taskId: TaskId): Promise<BidRecord[]> {
    const snap = await this.taskRef(taskId).collection("bids").orderBy("timestamp", "asc").get();
    return snap.docs.map((d) => BidRecordSchema.parse(d.data()));
  }

  async getAgentMapeRollup(agentId: AgentId): Promise<AgentMapeRollup | null> {
    const snap = await this.mapeRollupRef(agentId).get();
    if (!snap.exists) return null;
    return AgentMapeRollupSchema.parse(snap.data());
  }

  async getAgentDeclineRollup(agentId: AgentId): Promise<AgentDeclineRollup | null> {
    const snap = await this.declineRollupRef(agentId).get();
    if (!snap.exists) return null;
    return AgentDeclineRollupSchema.parse(snap.data());
  }

  async getAgentWinRateRollup(agentId: AgentId): Promise<AgentWinRateRollup | null> {
    const snap = await this.winRateRollupRef(agentId).get();
    if (!snap.exists) return null;
    return AgentWinRateRollupSchema.parse(snap.data());
  }

  async awardTask(input: AwardTaskInput): Promise<TaskRecord> {
    const ref = this.taskRef(input.taskId);
    return this.firestore.runTransaction(async (tx) => {
      const task = await this.readTask(tx, ref, input.taskId);

      if (
        task.status === "awarded" &&
        task.winner_agent_id === input.winnerAgentId &&
        task.auction_price_usd === input.auctionPriceUsd &&
        task.winning_bid_usd === input.winningBidUsd
      ) {
        return task;
      }
      this.requireTransition(input.taskId, task.status, "awarded");

      const next: TaskRecord = {
        ...task,
        status: "awarded",
        updated_at: nowIso(input.now),
        winner_agent_id: input.winnerAgentId,
        auction_price_usd: input.auctionPriceUsd,
        winning_bid_usd: input.winningBidUsd,
      };
      tx.set(ref, stripUndefined(next));
      return next;
    });
  }

  async markExecuting(taskId: TaskId, now?: Date): Promise<TaskRecord> {
    const ref = this.taskRef(taskId);
    return this.firestore.runTransaction(async (tx) => {
      const task = await this.readTask(tx, ref, taskId);
      if (task.status === "executing") return task;
      this.requireTransition(taskId, task.status, "executing");
      const next: TaskRecord = { ...task, status: "executing", updated_at: nowIso(now) };
      tx.set(ref, stripUndefined(next));
      return next;
    });
  }

  async completeTask(input: CompleteTaskInput): Promise<TaskRecord> {
    const ref = this.taskRef(input.taskId);
    return this.firestore.runTransaction(async (tx) => {
      const task = await this.readTask(tx, ref, input.taskId);
      if (
        task.status === "completed" &&
        task.result &&
        task.result.output === input.result.output
      ) {
        return task;
      }
      this.requireTransition(input.taskId, task.status, "completed");
      const next: TaskRecord = {
        ...task,
        status: "completed",
        updated_at: nowIso(input.now),
        result: input.result,
      };
      await this.writeSettlementRollups(tx, next);
      tx.set(ref, stripUndefined(next));
      return next;
    });
  }

  async failTask(input: FailTaskInput): Promise<TaskRecord> {
    const ref = this.taskRef(input.taskId);
    return this.firestore.runTransaction(async (tx) => {
      const task = await this.readTask(tx, ref, input.taskId);
      if (task.status === "failed" && task.failure_reason === input.reason) return task;
      this.requireTransition(input.taskId, task.status, "failed");
      const next: TaskRecord = {
        ...task,
        status: "failed",
        updated_at: nowIso(input.now),
        failure_reason: input.reason,
      };
      tx.set(ref, stripUndefined(next));
      return next;
    });
  }

  private taskRef(taskId: TaskId): DocumentReference {
    return this.tasksCollection.doc(taskId);
  }

  private mapeRollupRef(agentId: AgentId): DocumentReference {
    return this.mapeRollupsCollection.doc(agentId);
  }

  private declineRollupRef(agentId: AgentId): DocumentReference {
    return this.declineRollupsCollection.doc(agentId);
  }

  private winRateRollupRef(agentId: AgentId): DocumentReference {
    return this.winRateRollupsCollection.doc(agentId);
  }

  private async writeBidResponseRollups(
    tx: Transaction,
    previousBid: BidRecord | undefined,
    nextBid: BidRecord,
  ): Promise<void> {
    const declineRollupRef = this.declineRollupRef(nextBid.agent_id);
    const winRateRollupRef = this.winRateRollupRef(nextBid.agent_id);
    const previousDeclineRollupSnap = await tx.get(declineRollupRef);
    const previousBidForWinRate =
      previousBid && !isNoBid(previousBid.response) ? previousBid.response : undefined;
    const shouldUpdateWinRate = previousBidForWinRate !== undefined || !isNoBid(nextBid.response);
    const previousWinRateRollupSnap = shouldUpdateWinRate ? await tx.get(winRateRollupRef) : null;

    const previousDeclineRollup = previousDeclineRollupSnap.exists
      ? AgentDeclineRollupSchema.parse(previousDeclineRollupSnap.data())
      : null;
    tx.set(
      declineRollupRef,
      stripUndefined(
        applyDeclineRollupUpdate(previousDeclineRollup, {
          previousResponse: previousBid?.response,
          nextResponse: nextBid.response,
          updatedAt: nextBid.timestamp,
        }),
      ),
    );

    const previousWinRateRollup = previousWinRateRollupSnap?.exists
      ? AgentWinRateRollupSchema.parse(previousWinRateRollupSnap.data())
      : null;
    if (isNoBid(nextBid.response)) {
      if (!previousBidForWinRate) return;
      tx.set(
        winRateRollupRef,
        stripUndefined(
          applyWinRateBidRemoval(previousWinRateRollup, {
            previousBid: previousBidForWinRate,
            updatedAt: nextBid.timestamp,
          }),
        ),
      );
      return;
    }

    tx.set(
      winRateRollupRef,
      stripUndefined(
        applyWinRateBidUpdate(previousWinRateRollup, {
          previousBid: previousBidForWinRate,
          nextBid: nextBid.response,
          updatedAt: nextBid.timestamp,
        }),
      ),
    );
  }

  private async writeSettlementRollups(tx: Transaction, task: TaskRecord): Promise<void> {
    if (!task.winner_agent_id || !task.result) return;

    const bidSnap = await tx.get(
      this.taskRef(task.task_id).collection("bids").doc(task.winner_agent_id),
    );
    if (!bidSnap.exists) return;
    const bidRecord = BidRecordSchema.parse(bidSnap.data());
    if (isNoBid(bidRecord.response)) return;

    const mapeRollupRef = this.mapeRollupRef(task.winner_agent_id);
    const winRateRollupRef = this.winRateRollupRef(task.winner_agent_id);
    const previousMapeRollupSnap = await tx.get(mapeRollupRef);
    const previousWinRateRollupSnap = await tx.get(winRateRollupRef);

    const sample = computeBidAccuracySample(bidRecord.response, task.result);
    if (sample) {
      const previousMapeRollup = previousMapeRollupSnap.exists
        ? AgentMapeRollupSchema.parse(previousMapeRollupSnap.data())
        : null;
      tx.set(
        mapeRollupRef,
        stripUndefined(
          applyBidAccuracySample(previousMapeRollup, {
            agentId: task.winner_agent_id,
            taskId: task.task_id,
            updatedAt: task.updated_at,
            sample,
          }),
        ),
      );
    }

    const previousWinRateRollup = previousWinRateRollupSnap.exists
      ? AgentWinRateRollupSchema.parse(previousWinRateRollupSnap.data())
      : null;
    tx.set(
      winRateRollupRef,
      stripUndefined(
        applyWinRateWinUpdate(previousWinRateRollup, {
          winningBid: bidRecord.response,
          updatedAt: task.updated_at,
        }),
      ),
    );
  }

  private async readTask(
    tx: Transaction,
    ref: DocumentReference,
    taskId: TaskId,
  ): Promise<TaskRecord> {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new TaskNotFoundError(taskId);
    return TaskRecordSchema.parse(snap.data());
  }

  private requireTransition(taskId: TaskId, from: TaskStatus, to: TaskStatus): void {
    if (!canTransition(from, to)) {
      throw new InvalidTransitionError(taskId, from, to);
    }
  }
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

// Firestore refuses to write `undefined` values. Strip them before set/create
// so optional fields stay absent rather than persisting as null.
function stripUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

interface FirestoreError {
  code?: number;
}

// gRPC code 6 = ALREADY_EXISTS — thrown by DocumentReference#create when the
// doc already exists. We translate to a typed error so callers don't need to
// know the SDK's error shape.
function isAlreadyExists(err: unknown): err is FirestoreError {
  return typeof err === "object" && err !== null && (err as FirestoreError).code === 6;
}

import type {
  ActualUsage,
  AgentId,
  BidResponse,
  PricingEntry,
  Result,
  TaskId,
  TaskSpec,
} from "@agent-tasker/protocol";
import type { AgentDeclineRollup, AgentMapeRollup, BidRecord, TaskRecord } from "./types.js";

// Persistence layer for the auction. All transition methods are idempotent at
// the document-key level — retrying the same call with the same input
// produces the same end state and never resurrects a terminal task.
//
// Two implementations:
//   - InMemoryLedgerStore  (./in-memory-store.ts) for tests and local dev
//   - FirestoreLedgerStore (./firestore-store.ts) for production
//
// New methods land here as the auction grows (awards subcollection for
// re-auction tracking #53, results subcollection for per-attempt outputs).
export interface LedgerStore {
  // Create a brand-new task in the `bidding` state. Throws
  // TaskAlreadyExistsError if `taskId` is already on file — coordinator
  // generates fresh ULIDs per POST /tasks so this should never collide in
  // practice; failing loud is the right move if it does.
  createTask(input: CreateTaskInput): Promise<TaskRecord>;

  // Returns null if not found. Callers needing strictness throw
  // TaskNotFoundError themselves.
  getTask(taskId: TaskId): Promise<TaskRecord | null>;

  // Idempotent: keyed by (taskId, response.agent_id). Re-writing the same
  // response overwrites; re-writing a different response from the same agent
  // replaces the prior one (final-write-wins). Per-task lifetime is short
  // enough that this corner is mostly theoretical.
  recordBidResponse(input: RecordBidResponseInput): Promise<BidRecord>;

  listBids(taskId: TaskId): Promise<BidRecord[]>;

  getAgentMapeRollup(agentId: AgentId): Promise<AgentMapeRollup | null>;

  getAgentDeclineRollup(agentId: AgentId): Promise<AgentDeclineRollup | null>;

  // Transitions bidding → awarded. Re-auction may also transition
  // executing → awarded with a different winner after excluding a failed
  // executor. Idempotent only if the *same* winner + pricing is reasserted.
  awardTask(input: AwardTaskInput): Promise<TaskRecord>;

  // Transitions awarded → executing. Idempotent if already executing.
  markExecuting(taskId: TaskId, now?: Date): Promise<TaskRecord>;

  // Transitions executing → completed. Idempotent if the same result is
  // reasserted. On first completion, writes the winning agent's MAPE rollup
  // when the winning bid record is available and MAPE-eligible.
  completeTask(input: CompleteTaskInput): Promise<TaskRecord>;

  // Move into the terminal `failed` state from any non-terminal state.
  // Re-auction (#53) happens at a higher layer — this just records that
  // the current attempt is over.
  failTask(input: FailTaskInput): Promise<TaskRecord>;
}

export interface CreateTaskInput {
  taskId: TaskId;
  spec: TaskSpec;
  now?: Date;
}

export interface RecordBidResponseInput {
  taskId: TaskId;
  response: BidResponse;
  pricingSnapshot: PricingEntry[];
  now?: Date;
}

export interface AwardTaskInput {
  taskId: TaskId;
  winnerAgentId: AgentId;
  auctionPriceUsd: number;
  winningBidUsd: number;
  now?: Date;
}

export interface CompleteTaskInput {
  taskId: TaskId;
  result: Result;
  // actualUsage is part of result per protocol — listed here as a reminder
  // that completeTask should also update MAPE rollups in a follow-up (#66).
  actualUsage?: ActualUsage;
  now?: Date;
}

export interface FailTaskInput {
  taskId: TaskId;
  reason: string;
  now?: Date;
}

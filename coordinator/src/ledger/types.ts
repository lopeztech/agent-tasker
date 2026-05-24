import { z } from "zod";
import {
  AgentIdSchema,
  BidResponseSchema,
  NoBidReasonSchema,
  PricingEntrySchema,
  ResultSchema,
  TaskIdSchema,
  TaskSpecSchema,
  TaskStatusSchema,
} from "@agent-tasker/protocol";

const Iso8601 = z.string().datetime({ offset: true });

// Root document at tasks/{task_id}. Holds task spec, current lifecycle
// status, and post-settlement totals. The winner_agent_id / pricing /
// result fields are populated as the task progresses; their presence is a
// derived signal of how far through the lifecycle a task is, but `status`
// remains the source of truth for transition gating.
export const TaskRecordSchema = z.object({
  task_id: TaskIdSchema,
  status: TaskStatusSchema,
  spec: TaskSpecSchema,
  created_at: Iso8601,
  updated_at: Iso8601,

  // Populated when status moves into `awarded`.
  winner_agent_id: AgentIdSchema.optional(),
  auction_price_usd: z.number().nonnegative().optional(), // Vickrey: second-lowest bid
  winning_bid_usd: z.number().nonnegative().optional(), //   winner's own bid (for MAPE)

  // Populated when status moves into `completed`.
  result: ResultSchema.optional(),

  // Populated when status moves into `failed`. Free-form so re-auction logic
  // (#53) can record both agent-attributable failures and infra failures.
  failure_reason: z.string().optional(),
});
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

// Per-agent bid record at tasks/{task_id}/bids/{agent_id}. Each agent has
// at most one bid record per task — retried writes overwrite the prior one
// with the same content (idempotent at the doc-key level).
//
// `pricing_snapshot` captures the prices the bidder used so MAPE replay
// remains reproducible even after the pricing collection rolls forward.
// `response_kind` / `no_bid_reason` / `mape_eligible` intentionally
// denormalize the union response so decline-rate queries and future MAPE
// rollups do not have to inspect nested response shapes.
export const BidRecordSchema = z.object({
  task_id: TaskIdSchema,
  agent_id: AgentIdSchema,
  timestamp: Iso8601,
  phase: z.literal("bid"),
  response_kind: z.enum(["bid", "no_bid"]),
  no_bid_reason: NoBidReasonSchema.optional(),
  mape_eligible: z.boolean(),
  response: BidResponseSchema,
  pricing_snapshot: z.array(PricingEntrySchema),
});
export type BidRecord = z.infer<typeof BidRecordSchema>;

// Per-agent rolling bid accuracy at agent_mape_rollups/{agent_id}. Updated
// when a winning task settles so tie-breaking and later score-weighted
// auction layers can read one small document instead of scanning history.
export const AgentMapeRollupSchema = z.object({
  agent_id: AgentIdSchema,
  updated_at: Iso8601,
  settled_task_count: z.number().int().nonnegative(),
  absolute_percentage_error_sum: z.number().nonnegative(),
  signed_percentage_error_sum: z.number(),
  mape: z.number().nonnegative(),
  mean_signed_percentage_error: z.number(),
  last_task_id: TaskIdSchema,
  last_bid_usd: z.number().nonnegative(),
  last_actual_usd: z.number().nonnegative(),
  last_absolute_percentage_error: z.number().nonnegative(),
  last_signed_percentage_error: z.number(),
});
export type AgentMapeRollup = z.infer<typeof AgentMapeRollupSchema>;

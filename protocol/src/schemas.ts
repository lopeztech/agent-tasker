import { z } from "zod";
import { AgentIdSchema, ModelFamilySchema } from "./agents.js";
import { TierSchema } from "./tiers.js";

const NonNegInt = z.number().int().nonnegative();
const NonNegNum = z.number().nonnegative();
const Iso8601 = z.string().datetime({ offset: true });

export const TaskIdSchema = z.string().min(1);
export type TaskId = z.infer<typeof TaskIdSchema>;

// Attachments are content-hash-only by default to avoid cross-cloud egress
// of large payloads; agents pull bytes from a signed URL when one is set.
export const AttachmentSchema = z.object({
  content_hash: z.string().min(1),
  url: z.string().url().optional(),
  mime_type: z.string().optional(),
  byte_size: NonNegInt.optional(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

// What the client submits to POST /tasks.
export const TaskSpecSchema = z.object({
  prompt: z.string().min(1),
  attachments: z.array(AttachmentSchema).optional(),
  min_tier: TierSchema.optional(),
  callback_url: z.string().url().optional(),
  deadline: Iso8601.optional(),
});
export type TaskSpec = z.infer<typeof TaskSpecSchema>;

// Bid returned by an agent's /bid handler.
export const BidSchema = z.object({
  task_id: TaskIdSchema,
  agent_id: AgentIdSchema,
  tier: TierSchema,
  model_family: ModelFamilySchema,
  // Exact pinned id for audit only; not exposed to winner selection.
  model_id: z.string().min(1),
  est_input_tokens: NonNegInt,
  est_output_tokens: NonNegInt,
  price_in_usd_per_mtoken: NonNegNum,
  price_out_usd_per_mtoken: NonNegNum,
  bid_usd: NonNegNum,
  expires_at: Iso8601,
  signature: z.string().min(1),
});
export type Bid = z.infer<typeof BidSchema>;

export const NO_BID_REASONS = [
  "context_overflow",
  "policy",
  "capability",
  "internal_error",
] as const;
export const NoBidReasonSchema = z.enum(NO_BID_REASONS);
export type NoBidReason = z.infer<typeof NoBidReasonSchema>;

// Decline-to-bid. Reason codes bucket separately from real bids so they
// don't pollute MAPE.
export const NoBidSchema = z.object({
  task_id: TaskIdSchema,
  agent_id: AgentIdSchema,
  status: z.literal("no_bid"),
  reason: NoBidReasonSchema,
});
export type NoBid = z.infer<typeof NoBidSchema>;

// Coordinator parses /bid responses as one of these.
export const BidResponseSchema = z.union([BidSchema, NoBidSchema]);
export type BidResponse = z.infer<typeof BidResponseSchema>;

export function isNoBid(response: BidResponse): response is NoBid {
  return "status" in response && response.status === "no_bid";
}

// Award sent to the winner. Vickrey: auction_price_usd is the second-lowest
// bid; original_bid_usd is the winner's own bid (recorded for accuracy).
export const AwardSchema = z.object({
  task_id: TaskIdSchema,
  agent_id: AgentIdSchema,
  auction_price_usd: NonNegNum,
  original_bid_usd: NonNegNum,
  expires_at: Iso8601,
  signature: z.string().min(1),
});
export type Award = z.infer<typeof AwardSchema>;

// Reject sent to losers; signed so the agent can verify the round closed.
export const RejectSchema = z.object({
  task_id: TaskIdSchema,
  agent_id: AgentIdSchema,
  signature: z.string().min(1),
});
export type Reject = z.infer<typeof RejectSchema>;

export const ActualUsageSchema = z.object({
  input_tokens: NonNegInt,
  output_tokens: NonNegInt,
});
export type ActualUsage = z.infer<typeof ActualUsageSchema>;

export const StepTraceActionSchema = z.object({
  tool: z.string().min(1),
  query: z.string().optional(),
  observation: z.string().optional(),
});
export type StepTraceAction = z.infer<typeof StepTraceActionSchema>;

export const StepTraceStepSchema = z.object({
  index: NonNegInt,
  state: z.string().optional(),
  description: z.string().optional(),
  actions: z.array(StepTraceActionSchema),
});
export type StepTraceStep = z.infer<typeof StepTraceStepSchema>;

export const StepTraceSchema = z.object({
  total_steps: NonNegInt,
  tool_call_count: NonNegInt,
  steps: z.array(StepTraceStepSchema),
});
export type StepTrace = z.infer<typeof StepTraceSchema>;

// Result returned by the winner's /execute handler.
export const ResultSchema = z.object({
  task_id: TaskIdSchema,
  agent_id: AgentIdSchema,
  output: z.string(),
  actual_usage: ActualUsageSchema,
  step_trace: StepTraceSchema.optional(),
});
export type Result = z.infer<typeof ResultSchema>;

// Lifecycle states surfaced through GET /tasks/:id.
export const TASK_STATUSES = ["bidding", "awarded", "executing", "completed", "failed"] as const;
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// Phase claim in the coordinator-signed JWT.
export const JWT_PHASES = ["bid", "award", "execute", "reject"] as const;
export const JwtPhaseSchema = z.enum(JWT_PHASES);
export type JwtPhase = z.infer<typeof JwtPhaseSchema>;

// Wire shapes the coordinator sends to each agent. JWT (auth, phase) goes
// in the Authorization header; the body carries the task_id + spec so the
// agent can bid/execute without round-tripping back to the coordinator.
export const AnnounceRequestSchema = z.object({
  task_id: TaskIdSchema,
  spec: TaskSpecSchema,
});
export type AnnounceRequest = z.infer<typeof AnnounceRequestSchema>;

export const ExecuteRequestSchema = z.object({
  task_id: TaskIdSchema,
  spec: TaskSpecSchema,
});
export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>;

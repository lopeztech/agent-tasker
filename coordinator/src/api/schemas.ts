import { z } from "zod";
import {
  AgentIdSchema,
  ResultSchema,
  TaskIdSchema,
  TaskSpecSchema,
  TaskStatusSchema,
} from "@agent-tasker/protocol";

// Public client API for the coordinator. Lives in coordinator/src/api/
// rather than /protocol because it's client-coordinator, not
// coordinator-agent. Promote to /protocol if a non-SPA consumer ever
// needs to share the shape.

// POST /tasks → 202 { task_id, status_url }
export const CreateTaskRequestSchema = TaskSpecSchema;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const CreateTaskResponseSchema = z.object({
  task_id: TaskIdSchema,
  status_url: z.string().url(),
});
export type CreateTaskResponse = z.infer<typeof CreateTaskResponseSchema>;

// GET /tasks/:id → 200 { status, ... }
// `output` / `winner_agent_id` / `auction_price_usd` / `failure_reason`
// are present-or-absent depending on `status`. Clients should branch on
// `status` first and read the rest only when defined.
export const GetTaskResponseSchema = z.object({
  task_id: TaskIdSchema,
  status: TaskStatusSchema,
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  winner_agent_id: AgentIdSchema.optional(),
  auction_price_usd: z.number().nonnegative().optional(),
  winning_bid_usd: z.number().nonnegative().optional(),
  result: ResultSchema.optional(),
  failure_reason: z.string().optional(),
});
export type GetTaskResponse = z.infer<typeof GetTaskResponseSchema>;

// Shared error envelope. Coordinator only emits structured errors; the SPA
// is expected to surface `code` for branching and `message` for display.
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

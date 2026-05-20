import type { Context } from "hono";
import type { LedgerStore } from "../../ledger/store.js";
import type { TaskRecord } from "../../ledger/types.js";
import type { GetTaskResponse } from "../schemas.js";

export interface GetTaskDeps {
  store: LedgerStore;
}

export async function handleGetTask(c: Context, deps: GetTaskDeps): Promise<Response> {
  const taskId = c.req.param("id");
  if (!taskId) {
    return c.json({ error: { code: "invalid_request", message: "missing task id" } }, 400);
  }

  const record = await deps.store.getTask(taskId);
  if (!record) {
    return c.json({ error: { code: "not_found", message: `task ${taskId} not found` } }, 404);
  }

  return c.json(projectTaskRecord(record));
}

// Projection from the internal TaskRecord (which includes the spec, etc.)
// to the public GET /tasks/:id response shape. The spec isn't echoed back
// — the client sent it and doesn't need to read it from us.
function projectTaskRecord(record: TaskRecord): GetTaskResponse {
  const response: GetTaskResponse = {
    task_id: record.task_id,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
  if (record.winner_agent_id !== undefined) response.winner_agent_id = record.winner_agent_id;
  if (record.auction_price_usd !== undefined) response.auction_price_usd = record.auction_price_usd;
  if (record.winning_bid_usd !== undefined) response.winning_bid_usd = record.winning_bid_usd;
  if (record.result !== undefined) response.result = record.result;
  if (record.failure_reason !== undefined) response.failure_reason = record.failure_reason;
  return response;
}

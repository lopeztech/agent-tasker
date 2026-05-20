import type { Context } from "hono";
import { ulid } from "ulid";
import type { AuctionRunner } from "../../auction/runner.js";
import type { LedgerStore } from "../../ledger/store.js";
import { CreateTaskRequestSchema, type CreateTaskResponse } from "../schemas.js";

export interface PostTasksDeps {
  store: LedgerStore;
  runner: AuctionRunner;
  // Optional override for tests / deterministic ID generation. Defaults to ulid().
  idGenerator?: () => string;
}

export async function handlePostTasks(c: Context, deps: PostTasksDeps): Promise<Response> {
  const body = await safeJson(c);
  const parsed = CreateTaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: "invalid_request",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
        },
      },
      400,
    );
  }

  const taskId = (deps.idGenerator ?? ulid)();
  await deps.store.createTask({ taskId, spec: parsed.data });

  // Fire-and-forget auction kickoff. See AuctionRunner JSDoc for the
  // lifetime expectations on Cloud Run (`cpu_idle = false`).
  deps.runner.start(taskId);

  const url = new URL(c.req.url);
  const statusUrl = `${url.origin}/tasks/${taskId}`;

  const response: CreateTaskResponse = { task_id: taskId, status_url: statusUrl };
  return c.json(response, 202);
}

async function safeJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

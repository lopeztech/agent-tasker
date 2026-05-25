import type { TaskId } from "@agent-tasker/protocol";
import type { TaskRecord } from "../ledger/types.js";

export interface WebhookSigner {
  sign(args: { taskId: TaskId; callbackUrl: string }): Promise<string>;
}

export interface WebhookDeliveryOptions {
  task: TaskRecord;
  signer: WebhookSigner;
  fetch: typeof fetch;
  maxAttempts?: number;
  initialBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface WebhookDeliveryResult {
  ok: boolean;
  attempts: number;
  status?: number;
  error?: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 250;

export async function deliverCompletionWebhook(
  opts: WebhookDeliveryOptions,
): Promise<WebhookDeliveryResult> {
  const callbackUrl = opts.task.spec.callback_url;
  if (!callbackUrl) return { ok: true, attempts: 0 };

  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialBackoffMs = opts.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const token = await opts.signer.sign({ taskId: opts.task.task_id, callbackUrl });
  const body = JSON.stringify(completionPayload(opts.task));
  const idempotencyKey = `task:${opts.task.task_id}:completed`;

  let lastFailure: WebhookDeliveryResult = { ok: false, attempts: 0 };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await opts.fetch(callbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "idempotency-key": idempotencyKey,
          "x-agent-tasker-event": "task.completed",
        },
        body,
      });
      if (res.ok) return { ok: true, attempts: attempt, status: res.status };
      lastFailure = {
        ok: false,
        attempts: attempt,
        status: res.status,
        error: `callback returned ${res.status}`,
      };
    } catch (err) {
      lastFailure = {
        ok: false,
        attempts: attempt,
        error: err instanceof Error ? err.message : "callback delivery failed",
      };
    }

    if (attempt < maxAttempts) {
      await sleep(initialBackoffMs * 2 ** (attempt - 1));
    }
  }

  return lastFailure;
}

function completionPayload(task: TaskRecord) {
  return {
    task_id: task.task_id,
    status: task.status,
    winner_agent_id: task.winner_agent_id,
    auction_price_usd: task.auction_price_usd,
    result: task.result,
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

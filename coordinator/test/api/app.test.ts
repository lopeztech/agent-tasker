import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app.js";
import { StubAuctionRunner } from "../../src/auction/runner.js";
import { InMemoryLedgerStore } from "../../src/ledger/in-memory-store.js";
import { CreateTaskResponseSchema, GetTaskResponseSchema } from "../../src/api/schemas.js";

const idGenerator = (() => {
  let n = 0;
  return () => `01TASKTEST${(++n).toString().padStart(16, "0")}`;
})();

let store: InMemoryLedgerStore;
let runner: StubAuctionRunner;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  store = new InMemoryLedgerStore();
  runner = new StubAuctionRunner();
  app = createApp({ store, runner, idGenerator });
});

async function post(body: unknown): Promise<Response> {
  return app.request("/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe("POST /tasks", () => {
  it("creates a task, returns 202 with task_id + status_url, and kicks off the runner", async () => {
    const res = await post({ prompt: "summarize the transcript" });
    expect(res.status).toBe(202);
    const body = CreateTaskResponseSchema.parse(await res.json());
    expect(body.task_id).toMatch(/^01TASKTEST/);
    expect(body.status_url).toContain(`/tasks/${body.task_id}`);

    const stored = await store.getTask(body.task_id);
    expect(stored?.status).toBe("bidding");
    expect(stored?.spec.prompt).toBe("summarize the transcript");

    expect(runner.started).toEqual([body.task_id]);
  });

  it("400s on missing prompt", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toMatch(/prompt/i);
    expect(runner.started).toEqual([]);
  });

  it("400s on malformed JSON body", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });

  it("accepts optional fields (min_tier, deadline, callback_url, attachments)", async () => {
    const res = await post({
      prompt: "complex multi-step task",
      min_tier: "frontier",
      deadline: "2026-05-21T00:00:00Z",
      callback_url: "https://client.example.com/done",
      attachments: [{ content_hash: "sha256:abc" }],
    });
    expect(res.status).toBe(202);
    const body = CreateTaskResponseSchema.parse(await res.json());
    const stored = await store.getTask(body.task_id);
    expect(stored?.spec.min_tier).toBe("frontier");
    expect(stored?.spec.attachments).toHaveLength(1);
  });
});

describe("GET /tasks/:id", () => {
  it("returns 404 for unknown id", async () => {
    const res = await app.request("/tasks/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("returns the projected task record (status, timestamps, optional fields absent before settlement)", async () => {
    await post({ prompt: "task one" });
    const taskId = runner.started[0]!;
    const res = await app.request(`/tasks/${taskId}`);
    expect(res.status).toBe(200);
    const body = GetTaskResponseSchema.parse(await res.json());
    expect(body.task_id).toBe(taskId);
    expect(body.status).toBe("bidding");
    expect(body.created_at).toBeDefined();
    expect(body.winner_agent_id).toBeUndefined();
    expect(body.result).toBeUndefined();
  });

  it("surfaces winner / pricing after award", async () => {
    await post({ prompt: "task one" });
    const taskId = runner.started[0]!;
    await store.awardTask({
      taskId,
      winnerAgentId: "gcp-gemini",
      auctionPriceUsd: 0.05,
      winningBidUsd: 0.02,
    });

    const res = await app.request(`/tasks/${taskId}`);
    const body = GetTaskResponseSchema.parse(await res.json());
    expect(body.status).toBe("awarded");
    expect(body.winner_agent_id).toBe("gcp-gemini");
    expect(body.auction_price_usd).toBe(0.05);
    expect(body.winning_bid_usd).toBe(0.02);
  });

  it("surfaces result after completion", async () => {
    await post({ prompt: "task one" });
    const taskId = runner.started[0]!;
    await store.awardTask({
      taskId,
      winnerAgentId: "gcp-gemini",
      auctionPriceUsd: 0.05,
      winningBidUsd: 0.02,
    });
    await store.markExecuting(taskId);
    await store.completeTask({
      taskId,
      result: {
        task_id: taskId,
        agent_id: "gcp-gemini",
        output: "done",
        actual_usage: { input_tokens: 100, output_tokens: 50 },
      },
    });

    const res = await app.request(`/tasks/${taskId}`);
    const body = GetTaskResponseSchema.parse(await res.json());
    expect(body.status).toBe("completed");
    expect(body.result?.output).toBe("done");
  });

  it("surfaces failure_reason on failure", async () => {
    await post({ prompt: "task one" });
    const taskId = runner.started[0]!;
    await store.failTask({ taskId, reason: "all agents declined" });

    const res = await app.request(`/tasks/${taskId}`);
    const body = GetTaskResponseSchema.parse(await res.json());
    expect(body.status).toBe("failed");
    expect(body.failure_reason).toBe("all agents declined");
  });
});

describe("404 handler", () => {
  it("returns a structured error envelope for unknown routes", async () => {
    const res = await app.request("/no-such-route");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toContain("/no-such-route");
  });
});

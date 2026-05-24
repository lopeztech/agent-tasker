import { describe, expect, it } from "vitest";
import { parseFixture, runEval, summarizeResults } from "../src/index.js";

describe("parseFixture", () => {
  it("accepts a named fixture with a task spec", () => {
    const fixture = parseFixture({
      name: "summary",
      task: { prompt: "summarize this" },
    });

    expect(fixture).toEqual({
      name: "summary",
      task: { prompt: "summarize this" },
    });
  });
});

describe("summarizeResults", () => {
  it("summarizes completion counts, winners, and average prices", () => {
    const summary = summarizeResults("fixture", 2, [
      {
        run: 1,
        task_id: "task-1",
        status: "completed",
        winner_agent_id: "gcp-gemini",
        winning_bid_usd: 0.02,
        auction_price_usd: 0.04,
      },
      {
        run: 2,
        task_id: "task-2",
        status: "failed",
        failure_reason: "all agents declined",
      },
    ]);

    expect(summary).toMatchObject({
      fixture_name: "fixture",
      runs_requested: 2,
      completed: 1,
      failed: 1,
      winners: { "gcp-gemini": 1 },
      average_winning_bid_usd: 0.02,
      average_auction_price_usd: 0.04,
    });
  });
});

describe("runEval", () => {
  it("posts fixture tasks and polls to terminal state", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "POST") {
        return jsonResponse(202, {
          task_id: "task-1",
          status_url: "http://coordinator.test/tasks/task-1",
        });
      }
      return jsonResponse(200, {
        task_id: "task-1",
        status: "completed",
        winner_agent_id: "gcp-gemini",
        winning_bid_usd: 0.02,
        auction_price_usd: 0.04,
        result: {
          actual_usage: { input_tokens: 10, output_tokens: 5 },
        },
      });
    };

    const summary = await runEval({
      coordinatorUrl: "http://coordinator.test",
      fixture: { name: "summary", task: { prompt: "summarize this" } },
      runs: 1,
      pollIntervalMs: 1,
      timeoutMs: 1000,
      fetchImpl,
      wait: async () => {},
    });

    expect(calls).toEqual([
      "POST http://coordinator.test/tasks",
      "GET http://coordinator.test/tasks/task-1",
    ]);
    expect(summary.results[0]).toMatchObject({
      task_id: "task-1",
      status: "completed",
      winner_agent_id: "gcp-gemini",
      input_tokens: 10,
      output_tokens: 5,
    });
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

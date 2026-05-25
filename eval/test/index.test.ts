import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
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

  it("preserves tier and expected USD range metadata", () => {
    const fixture = parseFixture({
      name: "summary",
      tier: "small",
      expected_usd_range: { min: 0.001, max: 0.02 },
      task: { prompt: "summarize this" },
    });

    expect(fixture).toMatchObject({
      tier: "small",
      expected_usd_range: { min: 0.001, max: 0.02 },
    });
  });

  it("loads every checked-in fixture", async () => {
    const fixturesDir = new URL("../fixtures", import.meta.url);
    const files = (await readdir(fixturesDir)).filter((file) => file.endsWith(".json"));

    expect(files.sort()).toEqual([
      "frontier-multistep-plan.json",
      "medium-structured-extraction.json",
      "small-summary.json",
    ]);

    for (const file of files) {
      const raw = JSON.parse(await readFile(join(fixturesDir.pathname, file), "utf8")) as unknown;
      const fixture = parseFixture(raw, file);
      expect(fixture.name).toBeTruthy();
      expect(fixture.task.prompt.length).toBeGreaterThan(20);
      expect(fixture.expected_usd_range?.max).toBeGreaterThan(fixture.expected_usd_range?.min ?? 0);
    }
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
      score: null,
    });
  });

  it("scores repeated stochastic runs against the fixture expected USD range", () => {
    const summary = summarizeResults(
      "fixture",
      3,
      [
        {
          run: 1,
          task_id: "task-1",
          status: "completed",
          winner_agent_id: "gcp-gemini",
          winning_bid_usd: 0.02,
          auction_price_usd: 0.03,
        },
        {
          run: 2,
          task_id: "task-2",
          status: "completed",
          winner_agent_id: "gcp-gemini",
          winning_bid_usd: 0.04,
          auction_price_usd: 0.06,
        },
        {
          run: 3,
          task_id: "task-3",
          status: "failed",
          failure_reason: "all agents declined",
        },
      ],
      { min: 0.02, max: 0.04 },
    );

    expect(summary.score).toEqual({
      expected_usd_range: { min: 0.02, max: 0.04, midpoint: 0.03 },
      winning_bid: {
        scored_runs: 2,
        mape: expect.closeTo(1 / 3),
        range_hit_rate: 1,
      },
      auction_price: {
        scored_runs: 2,
        mape: 0.5,
        range_hit_rate: 0.5,
      },
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

  it("includes MAPE scoring when the fixture declares an expected USD range", async () => {
    let taskId = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      if (init?.method === "POST") {
        taskId += 1;
        return jsonResponse(202, {
          task_id: `task-${taskId}`,
          status_url: `http://coordinator.test/tasks/task-${taskId}`,
        });
      }
      return jsonResponse(200, {
        task_id: `task-${taskId}`,
        status: "completed",
        winner_agent_id: "gcp-gemini",
        winning_bid_usd: taskId === 1 ? 0.02 : 0.04,
        auction_price_usd: taskId === 1 ? 0.03 : 0.05,
        result: {
          actual_usage: { input_tokens: 10, output_tokens: 5 },
        },
      });
    };

    const summary = await runEval({
      coordinatorUrl: "http://coordinator.test",
      fixture: {
        name: "summary",
        expected_usd_range: { min: 0.02, max: 0.04 },
        task: { prompt: "summarize this" },
      },
      runs: 2,
      pollIntervalMs: 1,
      timeoutMs: 1000,
      fetchImpl,
      wait: async () => {},
    });

    expect(summary.score?.winning_bid).toMatchObject({
      scored_runs: 2,
      mape: expect.closeTo(1 / 3),
      range_hit_rate: 1,
    });
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

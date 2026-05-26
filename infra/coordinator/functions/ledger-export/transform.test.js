import test from "node:test";
import assert from "node:assert/strict";
import { bidRow, resultRow, taskRow } from "./transform.js";

test("taskRow flattens client-facing fields and keeps JSON payloads", () => {
  assert.deepEqual(
    taskRow({
      task_id: "task-1",
      status: "completed",
      created_at: "2026-05-26T00:00:00.000Z",
      updated_at: "2026-05-26T00:01:00.000Z",
      winner_agent_id: "gcp-gemini",
      auction_price_usd: 0.04,
      winning_bid_usd: 0.02,
      spec: { prompt: "summarize", min_tier: "frontier" },
      result: {
        output: "done",
        actual_usage: { input_tokens: 1000, output_tokens: 200 },
      },
    }),
    {
      task_id: "task-1",
      status: "completed",
      created_at: "2026-05-26T00:00:00.000Z",
      updated_at: "2026-05-26T00:01:00.000Z",
      winner_agent_id: "gcp-gemini",
      auction_price_usd: 0.04,
      winning_bid_usd: 0.02,
      prompt: "summarize",
      min_tier: "frontier",
      output: "done",
      actual_input_tokens: 1000,
      actual_output_tokens: 200,
      spec_json: { prompt: "summarize", min_tier: "frontier" },
      result_json: {
        output: "done",
        actual_usage: { input_tokens: 1000, output_tokens: 200 },
      },
    },
  );
});

test("bidRow handles bids and no_bid rows", () => {
  assert.equal(
    bidRow({
      task_id: "task-1",
      agent_id: "aws-nova",
      timestamp: "2026-05-26T00:00:01.000Z",
      response_kind: "no_bid",
      no_bid_reason: "capability",
      response: { status: "no_bid", reason: "capability" },
    }).no_bid_reason,
    "capability",
  );

  assert.deepEqual(
    bidRow({
      task_id: "task-1",
      agent_id: "gcp-gemini",
      timestamp: "2026-05-26T00:00:01.000Z",
      response_kind: "bid",
      response: {
        tier: "frontier",
        model_family: "gemini",
        model_id: "gemini-2-5-pro",
        bid_usd: 0.02,
        est_input_tokens: 1000,
        est_output_tokens: 200,
      },
      pricing_snapshot: [{ model_id: "gemini-2-5-pro" }],
    }),
    {
      task_id: "task-1",
      agent_id: "gcp-gemini",
      timestamp: "2026-05-26T00:00:01.000Z",
      response_kind: "bid",
      tier: "frontier",
      model_family: "gemini",
      model_id: "gemini-2-5-pro",
      bid_usd: 0.02,
      est_input_tokens: 1000,
      est_output_tokens: 200,
      response_json: {
        tier: "frontier",
        model_family: "gemini",
        model_id: "gemini-2-5-pro",
        bid_usd: 0.02,
        est_input_tokens: 1000,
        est_output_tokens: 200,
      },
      pricing_snapshot_json: [{ model_id: "gemini-2-5-pro" }],
    },
  );
});

test("resultRow flattens GAEP step trace counters", () => {
  assert.deepEqual(
    resultRow({
      task_id: "task-1",
      agent_id: "gcp-orchestrator",
      timestamp: "2026-05-26T00:00:02.000Z",
      actual_input_tokens: 1200,
      actual_output_tokens: 300,
      actual_step_count: 3,
      actual_tool_call_count: 2,
      result: { output: "done" },
      step_trace: { total_steps: 3, tool_call_count: 2, steps: [] },
    }),
    {
      task_id: "task-1",
      agent_id: "gcp-orchestrator",
      timestamp: "2026-05-26T00:00:02.000Z",
      actual_input_tokens: 1200,
      actual_output_tokens: 300,
      actual_step_count: 3,
      actual_tool_call_count: 2,
      result_json: { output: "done" },
      step_trace_json: { total_steps: 3, tool_call_count: 2, steps: [] },
    },
  );
});

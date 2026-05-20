import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeAgent, type FakeAgent } from "./fake-agent.js";

let agent: FakeAgent;

afterEach(async () => {
  if (agent) await agent.stop();
});

describe("FakeAgent", () => {
  beforeEach(async () => {
    agent = await startFakeAgent({ agentId: "gcp-gemini" });
  });

  it("serves /health", async () => {
    const res = await fetch(`${agent.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, agent_id: "gcp-gemini" });
  });

  it("default /bid declines with capability", async () => {
    const res = await fetch(`${agent.url}/bid`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: "t-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      task_id: "t-1",
      agent_id: "gcp-gemini",
      status: "no_bid",
      reason: "capability",
    });
    expect(agent.bidCalls).toBe(1);
  });

  it("default /execute returns a canned successful result", async () => {
    const res = await fetch(`${agent.url}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: "t-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      task_id: "t-1",
      agent_id: "gcp-gemini",
      output: expect.stringContaining("gcp-gemini"),
    });
    expect(agent.executeCalls).toBe(1);
  });
});

describe("FakeAgent with overrides", () => {
  it("custom onBid returns a real bid", async () => {
    agent = await startFakeAgent({
      agentId: "aws-nova",
      onBid: (taskId) => ({
        task_id: taskId,
        agent_id: "aws-nova",
        tier: "frontier",
        model_family: "nova",
        model_id: "amazon.nova-pro",
        est_input_tokens: 1000,
        est_output_tokens: 500,
        price_in_usd_per_mtoken: 0.8,
        price_out_usd_per_mtoken: 3.2,
        bid_usd: 0.0024,
        expires_at: "2026-05-20T13:00:00Z",
        signature: "stub",
      }),
    });

    const res = await fetch(`${agent.url}/bid`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: "t-2" }),
    });
    expect(await res.json()).toMatchObject({
      agent_id: "aws-nova",
      tier: "frontier",
      bid_usd: 0.0024,
    });
  });
});

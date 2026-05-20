import { serve, type ServerType } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import type { AgentId, BidResponse, Result } from "@agent-tasker/protocol";

// Stand-in agent server. The real AuctionRunner (#47 + #52 + #53) will
// POST to /bid and /execute on each agent's base URL; this harness lets
// us stand up a configurable fake on an ephemeral port and assert on what
// the runner did. Today it has no consumer in coordinator/ but the unit
// tests in fake-agent.test.ts pin its behavior so the harness is ready
// to drop in when the real runner lands.

export interface FakeAgentOptions {
  agentId: AgentId;
  // Bid handler. Called with the announced taskId. Default: declines.
  onBid?: (taskId: string) => BidResponse;
  // Execute handler. Called with the awarded taskId. Default: returns a
  // canned successful result.
  onExecute?: (taskId: string) => Result;
}

export interface FakeAgent {
  readonly agentId: AgentId;
  readonly url: string;
  // Number of /bid and /execute calls observed. Reset per instance.
  bidCalls: number;
  executeCalls: number;
  stop(): Promise<void>;
}

export async function startFakeAgent(opts: FakeAgentOptions): Promise<FakeAgent> {
  const agentId = opts.agentId;
  const state = { bidCalls: 0, executeCalls: 0 };

  const onBid =
    opts.onBid ??
    ((taskId: string): BidResponse => ({
      task_id: taskId,
      agent_id: agentId,
      status: "no_bid",
      reason: "capability",
    }));

  const onExecute =
    opts.onExecute ??
    ((taskId: string): Result => ({
      task_id: taskId,
      agent_id: agentId,
      output: `stub output from ${agentId}`,
      actual_usage: { input_tokens: 100, output_tokens: 50 },
    }));

  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, agent_id: agentId }));

  app.post("/bid", async (c) => {
    state.bidCalls += 1;
    const body = (await c.req.json()) as { task_id?: string };
    if (!body.task_id) return c.json({ error: "task_id required" }, 400);
    return c.json(onBid(body.task_id));
  });

  app.post("/execute", async (c) => {
    state.executeCalls += 1;
    const body = (await c.req.json()) as { task_id?: string };
    if (!body.task_id) return c.json({ error: "task_id required" }, 400);
    return c.json(onExecute(body.task_id));
  });

  const server: ServerType = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0 }, () => resolve(s));
  });

  const address = server.address() as AddressInfo | null;
  if (!address || typeof address === "string") {
    throw new Error("fake agent server failed to bind to an address");
  }
  const url = `http://127.0.0.1:${address.port}`;

  const agent: FakeAgent = {
    agentId,
    url,
    get bidCalls() {
      return state.bidCalls;
    },
    get executeCalls() {
      return state.executeCalls;
    },
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };

  return agent;
}

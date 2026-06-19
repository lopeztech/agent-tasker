import { serve, type ServerType } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import {
  AnnounceRequestSchema,
  ExecuteRequestSchema,
  type AgentId,
  type AnnounceRequest,
  type BidResponse,
  type ExecuteRequest,
  type Result,
} from "@agent-tasker/protocol";

// Stand-in agent server. The real `HttpAuctionRunner` POSTs to /bid and
// /execute on each agent's base URL with `{ task_id, spec }` bodies; this
// harness lets tests stand up a configurable fake on an ephemeral port
// and assert on what the runner did.

export interface FakeAgentOptions {
  agentId: AgentId;
  // Bid handler. Receives the validated announce request. Default: declines.
  onBid?: (req: AnnounceRequest) => BidResponse | Promise<BidResponse>;
  // Execute handler. Receives the validated execute request. Default:
  // returns a canned successful result.
  onExecute?: (req: ExecuteRequest) => Result | Promise<Result>;
}

export interface CapturedRequest {
  path: "/bid" | "/execute";
  authorization: string | undefined;
  serverlessAuthorization: string | undefined;
}

export interface FakeAgent {
  readonly agentId: AgentId;
  readonly url: string;
  bidCalls: number;
  executeCalls: number;
  // Auth headers seen on each /bid and /execute request, in arrival order.
  readonly requests: CapturedRequest[];
  stop(): Promise<void>;
}

export async function startFakeAgent(opts: FakeAgentOptions): Promise<FakeAgent> {
  const agentId = opts.agentId;
  const state = { bidCalls: 0, executeCalls: 0 };
  const requests: CapturedRequest[] = [];

  const onBid =
    opts.onBid ??
    ((req: AnnounceRequest): BidResponse => ({
      task_id: req.task_id,
      agent_id: agentId,
      status: "no_bid",
      reason: "capability",
    }));

  const onExecute =
    opts.onExecute ??
    ((req: ExecuteRequest): Result => ({
      task_id: req.task_id,
      agent_id: agentId,
      output: `stub output from ${agentId}`,
      actual_usage: { input_tokens: 100, output_tokens: 50 },
    }));

  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, agent_id: agentId }));

  app.post("/bid", async (c) => {
    state.bidCalls += 1;
    requests.push(captureRequest(c, "/bid"));
    const body = (await c.req.json()) as unknown;
    const parsed = AnnounceRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    return c.json(await onBid(parsed.data));
  });

  app.post("/execute", async (c) => {
    state.executeCalls += 1;
    requests.push(captureRequest(c, "/execute"));
    const body = (await c.req.json()) as unknown;
    const parsed = ExecuteRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    return c.json(await onExecute(parsed.data));
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
    requests,
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

function captureRequest(
  c: { req: { header(name: string): string | undefined } },
  path: "/bid" | "/execute",
): CapturedRequest {
  return {
    path,
    authorization: c.req.header("authorization"),
    serverlessAuthorization: c.req.header("x-serverless-authorization"),
  };
}

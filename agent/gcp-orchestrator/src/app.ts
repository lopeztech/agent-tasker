import { Hono } from "hono";
import { AnnounceRequestSchema, ExecuteRequestSchema, type NoBid } from "@agent-tasker/protocol";
import {
  getTokenClaims,
  requireTaskToken,
  withAgentSpan,
  type TaskTokenVerifier,
} from "@agent-tasker/agent";
import { AGENT_ID } from "./index.js";
import { executeViaGaep, type GaepRuntimeClient } from "./runtime.js";

export interface CreateAppOptions {
  verifier: TaskTokenVerifier;
  runtime: GaepRuntimeClient;
}

export function createApp(opts: CreateAppOptions) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, agent_id: AGENT_ID }));

  app.post("/bid", requireTaskToken(opts.verifier, "bid"), async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    const parsed = AnnounceRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: "invalid_request", message: "bad announce body" } }, 400);
    }

    const claims = getTokenClaims(c);
    if (claims.task_id !== parsed.data.task_id) {
      return c.json(
        { error: { code: "unauthorized", message: "token task_id does not match body" } },
        401,
      );
    }

    const result = await withAgentSpan(
      "agent.bid",
      { task_id: parsed.data.task_id, agent_id: AGENT_ID, phase: "bid" },
      async (span): Promise<NoBid> => {
        span.setAttribute("no_bid_reason", "capability");
        return {
          task_id: parsed.data.task_id,
          agent_id: AGENT_ID,
          status: "no_bid",
          reason: "capability",
        };
      },
    );
    return c.json(result);
  });

  app.post("/execute", requireTaskToken(opts.verifier, "execute"), async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    const parsed = ExecuteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: "invalid_request", message: "bad execute body" } }, 400);
    }

    const claims = getTokenClaims(c);
    if (claims.task_id !== parsed.data.task_id) {
      return c.json(
        { error: { code: "unauthorized", message: "token task_id does not match body" } },
        401,
      );
    }

    const result = await withAgentSpan(
      "agent.execute",
      { task_id: parsed.data.task_id, agent_id: AGENT_ID, phase: "execute" },
      async (span) => {
        const executeResult = await executeViaGaep(parsed.data, opts.runtime);
        span.setAttributes({
          input_tokens: executeResult.actual_usage.input_tokens,
          output_tokens: executeResult.actual_usage.output_tokens,
        });
        return executeResult;
      },
    );
    return c.json(result);
  });

  app.onError((err, c) => {
    console.error("gcp-orchestrator unhandled error", err);
    return c.json(
      { error: { code: "internal_error", message: "agent failed to handle request" } },
      500,
    );
  });

  return app;
}

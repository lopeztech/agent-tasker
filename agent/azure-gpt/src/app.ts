import { Hono } from "hono";
import type { PricingEntry } from "@agent-tasker/protocol";
import { AnnounceRequestSchema, ExecuteRequestSchema, isNoBid } from "@agent-tasker/protocol";
import {
  getTokenClaims,
  requireTaskToken,
  withAgentSpan,
  type TaskTokenVerifier,
} from "@agent-tasker/agent";
import { handleBid } from "./bid/handler.js";
import type { BidEstimator } from "./bid/estimator.js";
import { handleExecute } from "./execute/handler.js";
import type { GenerativeTextClient } from "./execute/runner.js";
import { AGENT_ID } from "./index.js";

export interface CreateAppOptions {
  verifier: TaskTokenVerifier;
  estimator: BidEstimator;
  pricing: PricingEntry;
  client: GenerativeTextClient;
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
      async (span) => {
        const bidResult = await handleBid(parsed.data, {
          estimator: opts.estimator,
          pricing: opts.pricing,
        });
        if (isNoBid(bidResult)) {
          span.setAttribute("no_bid_reason", bidResult.reason);
        } else {
          span.setAttributes({ tier: bidResult.tier, bid_usd: bidResult.bid_usd });
        }
        return bidResult;
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
        const executeResult = await handleExecute(parsed.data, { client: opts.client });
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
    console.error("azure-gpt unhandled error", err);
    return c.json(
      { error: { code: "internal_error", message: "agent failed to handle request" } },
      500,
    );
  });

  return app;
}

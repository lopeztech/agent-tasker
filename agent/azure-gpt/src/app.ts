import { Hono } from "hono";
import { AnnounceRequestSchema, ExecuteRequestSchema } from "@agent-tasker/protocol";
import { getTokenClaims, requireTaskToken, type TaskTokenVerifier } from "@agent-tasker/agent";
import { AGENT_ID } from "./index.js";

export interface CreateAppOptions {
  verifier: TaskTokenVerifier;
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

    return c.json({
      task_id: parsed.data.task_id,
      agent_id: AGENT_ID,
      status: "no_bid",
      reason: "capability",
    });
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

    return c.json(
      {
        error: {
          code: "not_implemented",
          message: "azure-gpt execute handler is not implemented yet",
        },
      },
      501,
    );
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

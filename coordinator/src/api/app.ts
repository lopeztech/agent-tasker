import { Hono } from "hono";
import type { AuctionRunner } from "../auction/runner.js";
import type { LedgerStore } from "../ledger/store.js";
import { handleGetTask } from "./handlers/get-task.js";
import { handlePostTasks } from "./handlers/post-tasks.js";

export interface CreateAppOptions {
  store: LedgerStore;
  runner: AuctionRunner;
  // Override for tests that need a deterministic task_id.
  idGenerator?: () => string;
}

// Returns a fresh Hono app wired with the coordinator's client-facing routes.
// One factory per Cloud Run instance / per test — never share Hono apps
// across tests because the same dependency closures get baked in.
export function createApp(opts: CreateAppOptions) {
  const app = new Hono();

  app.get("/healthz", (c) => c.text("ok"));

  app.post("/tasks", (c) =>
    handlePostTasks(c, {
      store: opts.store,
      runner: opts.runner,
      ...(opts.idGenerator ? { idGenerator: opts.idGenerator } : {}),
    }),
  );

  app.get("/tasks/:id", (c) => handleGetTask(c, { store: opts.store }));

  // Unhandled-error envelope so the SPA always sees a structured body
  // rather than Hono's default text/html. Coordinator-internal failures
  // bubble up here (e.g. Firestore unavailable) — runtime details stay
  // server-side; the client gets a stable code.
  app.onError((err, c) => {
    console.error("coordinator unhandled error", err);
    return c.json(
      { error: { code: "internal_error", message: "coordinator failed to handle request" } },
      500,
    );
  });

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: `no route for ${c.req.path}` } }, 404),
  );

  return app;
}

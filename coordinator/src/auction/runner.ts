import type { TaskId } from "@agent-tasker/protocol";

// Kicks off the auction asynchronously for a freshly-created task. POST
// /tasks calls `start()` and returns 202 immediately — the runner is
// responsible for the announce/bid/award/execute/settle round-trip and any
// re-auctions, writing progress to the ledger as it goes.
//
// Phase 1: in-process fire-and-forget on Cloud Run (`cpu_idle = false`,
// memory bumped enough to keep the instance alive for the full auction).
// The bid round is capped at 5s and execution is mostly time waiting on
// the agent's HTTP response, so a single Cloud Run instance comfortably
// runs hundreds of concurrent auctions without queuing.
//
// Phase 2+: graduate to Cloud Tasks if the in-process model starts losing
// auctions during instance autoscale-down or if we want to centralize
// retry policy. The interface is intentionally narrow so a queue-based
// runner is a drop-in replacement.
export interface AuctionRunner {
  start(taskId: TaskId): void;
}

// Records `start()` calls without doing any work. Used by tests and by
// early-Phase-1 deploys where the real runner (#47 + #52 + #53) hasn't
// landed yet. Production wiring substitutes a real runner.
export class StubAuctionRunner implements AuctionRunner {
  readonly started: TaskId[] = [];

  start(taskId: TaskId): void {
    this.started.push(taskId);
  }
}

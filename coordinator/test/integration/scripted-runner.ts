import type { TaskId } from "@agent-tasker/protocol";
import type { AuctionRunner } from "../../src/auction/runner.js";

// Test helper. Calls `script(taskId)` whenever the coordinator's POST
// /tasks handler kicks off a new task. The script is expected to drive
// the ledger through the auction states (record bids, award, execute,
// complete or fail), simulating what the real AuctionRunner will do once
// #47/#52/#53 land.
//
// Returns a promise that the test can await on a per-task basis, so
// assertions can wait for the ledger to reach a settled state before
// reading GET /tasks/:id.
export class ScriptedAuctionRunner implements AuctionRunner {
  private readonly settlements = new Map<TaskId, Promise<void>>();

  constructor(private readonly script: (taskId: TaskId) => Promise<void>) {}

  start(taskId: TaskId): void {
    this.settlements.set(taskId, this.script(taskId));
  }

  // Returns a promise that resolves when the scripted lifecycle for this
  // task has finished. Throws if `start` was never called for `taskId`.
  settle(taskId: TaskId): Promise<void> {
    const settlement = this.settlements.get(taskId);
    if (!settlement) throw new Error(`no settlement registered for task ${taskId}`);
    return settlement;
  }
}

import type { TaskStatus } from "@agent-tasker/protocol";

// Auction lifecycle per CLAUDE.md → Bidding protocol. Terminal states have no
// outgoing transitions. Re-auction on /execute failure re-awards the same task
// attempt from `executing` back to `awarded`, excluding the failed winner.
export const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  bidding: ["awarded", "failed"],
  awarded: ["executing", "failed"],
  executing: ["awarded", "completed", "failed"],
  completed: [],
  failed: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly taskId: string,
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    super(`Task ${taskId}: invalid transition ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class TaskNotFoundError extends Error {
  constructor(readonly taskId: string) {
    super(`Task ${taskId} not found`);
    this.name = "TaskNotFoundError";
  }
}

export class TaskAlreadyExistsError extends Error {
  constructor(readonly taskId: string) {
    super(`Task ${taskId} already exists`);
    this.name = "TaskAlreadyExistsError";
  }
}

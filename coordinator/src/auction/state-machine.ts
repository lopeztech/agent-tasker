import type { TaskStatus } from "@agent-tasker/protocol";

// Auction lifecycle per CLAUDE.md → Bidding protocol. Terminal states have no
// outgoing transitions; re-auction on /execute failure (#53) is modeled as a
// *new* task lifecycle that links back to the original via a parent reference,
// not as a transition out of `failed`.
export const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  bidding: ["awarded", "failed"],
  awarded: ["executing", "failed"],
  executing: ["completed", "failed"],
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

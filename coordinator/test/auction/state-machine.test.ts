import { describe, it, expect } from "vitest";
import { TASK_STATUSES, type TaskStatus } from "@agent-tasker/protocol";
import { VALID_TRANSITIONS, canTransition } from "../../src/auction/state-machine.js";

describe("VALID_TRANSITIONS", () => {
  it("covers every status", () => {
    const covered = new Set(Object.keys(VALID_TRANSITIONS));
    for (const status of TASK_STATUSES) {
      expect(covered.has(status), `missing entry for ${status}`).toBe(true);
    }
  });

  it("terminal states have no outgoing transitions", () => {
    expect(VALID_TRANSITIONS.completed).toEqual([]);
    expect(VALID_TRANSITIONS.failed).toEqual([]);
  });

  it("every non-terminal state can transition to failed", () => {
    const nonTerminal: TaskStatus[] = ["bidding", "awarded", "executing"];
    for (const status of nonTerminal) {
      expect(VALID_TRANSITIONS[status]).toContain("failed");
    }
  });

  it("happy-path is bidding -> awarded -> executing -> completed", () => {
    expect(canTransition("bidding", "awarded")).toBe(true);
    expect(canTransition("awarded", "executing")).toBe(true);
    expect(canTransition("executing", "completed")).toBe(true);
  });

  it("allows re-auction from executing back to awarded", () => {
    expect(canTransition("executing", "awarded")).toBe(true);
  });

  it("rejects skipping states", () => {
    expect(canTransition("bidding", "executing")).toBe(false);
    expect(canTransition("bidding", "completed")).toBe(false);
    expect(canTransition("awarded", "completed")).toBe(false);
  });
});

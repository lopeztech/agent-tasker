import type { Result, TaskId } from "@agent-tasker/protocol";
import type { ResultRecord } from "./types.js";

export function buildResultRecord(taskId: TaskId, result: Result, timestamp: string): ResultRecord {
  return {
    task_id: taskId,
    agent_id: result.agent_id,
    timestamp,
    phase: "execute",
    result,
    step_trace: result.step_trace,
    actual_input_tokens: result.actual_usage.input_tokens,
    actual_output_tokens: result.actual_usage.output_tokens,
    actual_step_count: result.step_trace?.total_steps ?? 0,
    actual_tool_call_count: result.step_trace?.tool_call_count ?? 0,
  };
}

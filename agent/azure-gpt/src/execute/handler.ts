import type { ExecuteRequest, Result } from "@agent-tasker/protocol";
import { AGENT_ID } from "../index.js";
import type { GenerativeTextClient } from "./runner.js";

export interface ExecuteHandlerDeps {
  client: GenerativeTextClient;
}

export async function handleExecute(
  req: ExecuteRequest,
  deps: ExecuteHandlerDeps,
): Promise<Result> {
  const { output, input_tokens, output_tokens } = await deps.client.generate(req.spec.prompt);
  return {
    task_id: req.task_id,
    agent_id: AGENT_ID,
    output,
    actual_usage: {
      input_tokens,
      output_tokens,
    },
  };
}

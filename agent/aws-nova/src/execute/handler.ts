import type { ExecuteRequest, Result } from "@agent-tasker/protocol";
import { withAgentSpan } from "@agent-tasker/agent";
import { AGENT_ID } from "../index.js";
import type { GenerativeTextClient } from "./runner.js";

export interface ExecuteHandlerDeps {
  client: GenerativeTextClient;
}

export async function handleExecute(
  req: ExecuteRequest,
  deps: ExecuteHandlerDeps,
): Promise<Result> {
  return withAgentSpan(
    "agent.execute",
    { task_id: req.task_id, agent_id: AGENT_ID, phase: "execute" },
    async (span) => {
      const { output, input_tokens, output_tokens } = await deps.client.generate(req.spec.prompt);
      span.setAttributes({ input_tokens, output_tokens });
      return {
        task_id: req.task_id,
        agent_id: AGENT_ID,
        output,
        actual_usage: {
          input_tokens,
          output_tokens,
        },
      };
    },
  );
}

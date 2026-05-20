import type { ExecuteRequest, Result } from "@agent-tasker/protocol";
import { AGENT_ID } from "../bid/handler.js";
import type { GenerativeTextClient } from "./runner.js";

export interface ExecuteHandlerDeps {
  client: GenerativeTextClient;
}

// Direct single-call execution against Gemini 2.5 Pro. Unlike the bid
// handler, execute does NOT have a graceful fallback — if the model call
// fails, the error bubbles to the Hono handler which surfaces a 500;
// the coordinator's HttpAuctionRunner then records failTask with a
// reason mentioning this agent (covered by the runner's existing tests).
//
// `actual_usage` comes from Vertex's usageMetadata, so accuracy of MAPE
// rollups depends on Google reporting honest counts. For the orchestrator
// agent (#94) this gets more complicated — token counts have to be summed
// across all GAEP steps.
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

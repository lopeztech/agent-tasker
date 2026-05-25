import type { ExecuteRequest, Result } from "@agent-tasker/protocol";
import { AGENT_ID } from "./index.js";

export interface GaepRuntimeResult {
  output: string;
  input_tokens: number;
  output_tokens: number;
}

export interface GaepRuntimeClient {
  execute(req: ExecuteRequest): Promise<GaepRuntimeResult>;
}

export interface GaepRuntimeClientOptions {
  agentResourceName: string | undefined;
}

export function createGaepRuntimeClient(opts: GaepRuntimeClientOptions): GaepRuntimeClient {
  const agentResourceName = opts.agentResourceName?.trim();

  return {
    async execute(): Promise<GaepRuntimeResult> {
      if (!agentResourceName) {
        throw new Error("GAEP agent resource name is required before execution can run");
      }
      throw new Error(
        `GAEP runtime client for ${agentResourceName} is not implemented yet; issue #94 wires the Gemini Enterprise execution call`,
      );
    },
  };
}

export async function executeViaGaep(
  req: ExecuteRequest,
  client: GaepRuntimeClient,
): Promise<Result> {
  const result = await client.execute(req);
  return {
    task_id: req.task_id,
    agent_id: AGENT_ID,
    output: result.output,
    actual_usage: {
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
    },
  };
}

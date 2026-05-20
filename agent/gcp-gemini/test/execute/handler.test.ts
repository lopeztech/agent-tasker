import { describe, expect, it } from "vitest";
import type { ExecuteRequest } from "@agent-tasker/protocol";
import { handleExecute } from "../../src/execute/handler.js";
import type { GenerativeTextClient } from "../../src/execute/runner.js";

const REQ: ExecuteRequest = {
  task_id: "task-exec-1",
  spec: { prompt: "summarize the transcript" },
};

function stubClient(
  output: string,
  input_tokens: number,
  output_tokens: number,
): GenerativeTextClient {
  return {
    async generate() {
      return { output, input_tokens, output_tokens };
    },
  };
}

function recordingClient(): { client: GenerativeTextClient; promptSeen: string[] } {
  const seen: string[] = [];
  return {
    promptSeen: seen,
    client: {
      async generate(prompt) {
        seen.push(prompt);
        return { output: "ok", input_tokens: 10, output_tokens: 5 };
      },
    },
  };
}

describe("handleExecute", () => {
  it("returns a Result envelope with output + actual usage", async () => {
    const res = await handleExecute(REQ, {
      client: stubClient("the summary text", 4100, 950),
    });

    expect(res.task_id).toBe("task-exec-1");
    expect(res.agent_id).toBe("gcp-gemini");
    expect(res.output).toBe("the summary text");
    expect(res.actual_usage).toEqual({ input_tokens: 4100, output_tokens: 950 });
  });

  it("forwards the spec prompt verbatim to the client", async () => {
    const { client, promptSeen } = recordingClient();
    await handleExecute(REQ, { client });
    expect(promptSeen).toEqual(["summarize the transcript"]);
  });

  it("propagates client errors (the coordinator decides whether to re-auction)", async () => {
    const client: GenerativeTextClient = {
      async generate() {
        throw new Error("model overloaded");
      },
    };
    await expect(handleExecute(REQ, { client })).rejects.toThrow(/model overloaded/);
  });
});

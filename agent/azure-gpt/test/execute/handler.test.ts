import { describe, expect, it } from "vitest";
import { handleExecute } from "../../src/execute/handler.js";
import type { GenerativeTextClient } from "../../src/execute/runner.js";

describe("handleExecute", () => {
  it("returns an Azure/GPT Result with actual token usage", async () => {
    const client: GenerativeTextClient = {
      async generate(prompt) {
        expect(prompt).toBe("write the summary");
        return {
          output: "done",
          input_tokens: 1200,
          output_tokens: 300,
        };
      },
    };

    await expect(
      handleExecute({ task_id: "task-1", spec: { prompt: "write the summary" } }, { client }),
    ).resolves.toEqual({
      task_id: "task-1",
      agent_id: "azure-gpt",
      output: "done",
      actual_usage: {
        input_tokens: 1200,
        output_tokens: 300,
      },
    });
  });
});

import { describe, expect, it } from "vitest";
import { OrchestratorBidEstimator, type GenerativeJsonClient } from "../../src/bid/estimator.js";

describe("OrchestratorBidEstimator", () => {
  it("folds steps, tool calls, and platform overhead into token totals", async () => {
    const client: GenerativeJsonClient = {
      async generateJson() {
        return {
          est_steps: 4,
          est_tool_calls: 3,
          est_input_tokens_per_step: 1200,
          est_output_tokens_per_step: 350,
          est_tool_call_input_tokens: 800,
          est_platform_overhead_output_token_equivalent: 250,
        };
      },
    };

    const estimate = await new OrchestratorBidEstimator(client).estimate({
      prompt: "fetch docs, compare options, summarize",
      attachments: [{ content_hash: "sha256:abc", byte_size: 1234 }],
    });

    expect(estimate).toEqual({
      steps: 4,
      tool_calls: 3,
      input_tokens: 7200,
      output_tokens: 1650,
    });
  });

  it("rejects malformed estimates", async () => {
    const client: GenerativeJsonClient = {
      async generateJson() {
        return {
          est_steps: 0,
          est_tool_calls: -1,
          est_input_tokens_per_step: 100,
          est_output_tokens_per_step: 100,
          est_tool_call_input_tokens: 0,
        };
      },
    };

    await expect(new OrchestratorBidEstimator(client).estimate({ prompt: "x" })).rejects.toThrow();
  });
});

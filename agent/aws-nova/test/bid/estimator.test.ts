import { describe, expect, it } from "vitest";
import {
  buildNovaBidPrompt,
  NovaBidEstimator,
  type GenerativeJsonClient,
} from "../../src/bid/estimator.js";

describe("buildNovaBidPrompt", () => {
  it("uses Nova-specific guidance instead of reusing other model-family prompts", () => {
    const prompt = buildNovaBidPrompt({
      prompt: "Refactor this JSON-heavy Lambda handler.",
      min_tier: "frontier",
      attachments: [{ uri: "sha256:abc123", mime_type: "application/json" }],
    });

    expect(prompt).toContain("Amazon Nova Pro");
    expect(prompt).toContain("Nova-family tokenization");
    expect(prompt).toContain("not Claude, Gemini, or GPT examples");
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("Attachments: 1 hash reference");
    expect(prompt).toContain("Minimum tier requested by client: frontier");
    expect(prompt).toContain('"est_input_tokens"');
    expect(prompt).toContain('"est_output_tokens"');
  });
});

describe("NovaBidEstimator", () => {
  it("returns parsed token estimates from the Nova prompt client", async () => {
    const client: GenerativeJsonClient = {
      async generateJson(prompt) {
        expect(prompt).toContain("Write a migration plan");
        expect(prompt).toContain("Amazon Nova Pro");
        return { est_input_tokens: 2400, est_output_tokens: 700 };
      },
    };

    await expect(
      new NovaBidEstimator(client).estimate({ prompt: "Write a migration plan" }),
    ).resolves.toEqual({
      input_tokens: 2400,
      output_tokens: 700,
    });
  });

  it("rejects malformed estimator output", async () => {
    const client: GenerativeJsonClient = {
      async generateJson() {
        return { est_input_tokens: -1, est_output_tokens: 50 };
      },
    };

    await expect(
      new NovaBidEstimator(client).estimate({ prompt: "bad estimate" }),
    ).rejects.toThrow();
  });
});

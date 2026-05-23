import { describe, expect, it, vi } from "vitest";
import { AzureOpenAiBidEstimator, createAzureOpenAiJsonClient } from "../../src/bid/estimator.js";

describe("AzureOpenAiBidEstimator", () => {
  it("parses structured token estimates from the JSON client", async () => {
    const estimator = new AzureOpenAiBidEstimator({
      async generateJson(prompt) {
        expect(prompt).toContain("GPT-5");
        expect(prompt).toContain("summarize");
        return { est_input_tokens: 123, est_output_tokens: 45 };
      },
    });

    await expect(estimator.estimate({ prompt: "summarize" })).resolves.toEqual({
      input_tokens: 123,
      output_tokens: 45,
    });
  });
});

describe("createAzureOpenAiJsonClient", () => {
  it("calls Azure OpenAI chat completions and parses message JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"est_input_tokens":200,"est_output_tokens":80}' } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const client = createAzureOpenAiJsonClient({
      endpoint: "https://example.openai.azure.com/",
      deployment: "gpt-5-mini",
      apiKey: "test-key",
      apiVersion: "2025-04-01-preview",
    });

    await expect(client.generateJson("estimate this")).resolves.toEqual({
      est_input_tokens: 200,
      est_output_tokens: 80,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "https://example.openai.azure.com/openai/deployments/gpt-5-mini/chat/completions?api-version=2025-04-01-preview",
      ),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "api-key": "test-key" }),
      }),
    );

    fetchMock.mockRestore();
  });

  it("throws on non-2xx responses", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 429 }));
    const client = createAzureOpenAiJsonClient({
      endpoint: "https://example.openai.azure.com",
      deployment: "gpt-5-mini",
      apiKey: "test-key",
      apiVersion: "2025-04-01-preview",
    });

    await expect(client.generateJson("estimate this")).rejects.toThrow(
      /Azure OpenAI bid estimate failed with HTTP 429/,
    );

    fetchMock.mockRestore();
  });
});

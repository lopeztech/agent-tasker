import { describe, expect, it, vi } from "vitest";
import { createAzureOpenAiTextClient } from "../../src/execute/runner.js";

describe("createAzureOpenAiTextClient", () => {
  it("calls Azure OpenAI chat completions and maps output plus usage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "completed output" } }],
          usage: { prompt_tokens: 321, completion_tokens: 98 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const client = createAzureOpenAiTextClient({
      endpoint: "https://example.openai.azure.com/",
      deployment: "gpt-5",
      apiKey: "test-key",
      apiVersion: "2025-04-01-preview",
    });

    await expect(client.generate("do the work")).resolves.toEqual({
      output: "completed output",
      input_tokens: 321,
      output_tokens: 98,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "https://example.openai.azure.com/openai/deployments/gpt-5/chat/completions?api-version=2025-04-01-preview",
      ),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "api-key": "test-key" }),
        body: expect.stringContaining("do the work"),
      }),
    );

    fetchMock.mockRestore();
  });

  it("throws on non-2xx responses", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 429 }));
    const client = createAzureOpenAiTextClient({
      endpoint: "https://example.openai.azure.com",
      deployment: "gpt-5",
      apiKey: "test-key",
      apiVersion: "2025-04-01-preview",
    });

    await expect(client.generate("do the work")).rejects.toThrow(
      /Azure OpenAI execute failed with HTTP 429/,
    );

    fetchMock.mockRestore();
  });

  it("throws when usage is missing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createAzureOpenAiTextClient({
      endpoint: "https://example.openai.azure.com",
      deployment: "gpt-5",
      apiKey: "test-key",
      apiVersion: "2025-04-01-preview",
    });

    await expect(client.generate("do the work")).rejects.toThrow(
      /Azure OpenAI execute response missing usage/,
    );

    fetchMock.mockRestore();
  });
});

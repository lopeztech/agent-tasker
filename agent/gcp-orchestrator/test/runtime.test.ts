import { describe, expect, it } from "vitest";
import {
  buildAnswerUrl,
  createGaepRuntimeClient,
  parseGaepAnswerResponse,
} from "../src/runtime.js";

describe("buildAnswerUrl", () => {
  it("targets default_search for an engine resource", () => {
    expect(
      buildAnswerUrl(
        "https://discoveryengine.googleapis.com/v1",
        "projects/p/locations/global/collections/default_collection/engines/app",
      ),
    ).toBe(
      "https://discoveryengine.googleapis.com/v1/projects/p/locations/global/collections/default_collection/engines/app/servingConfigs/default_search:answer",
    );
  });

  it("accepts a fully-qualified serving config resource", () => {
    expect(
      buildAnswerUrl(
        "https://example.test/v1/",
        "projects/p/locations/global/collections/default_collection/engines/app/servingConfigs/custom",
      ),
    ).toBe(
      "https://example.test/v1/projects/p/locations/global/collections/default_collection/engines/app/servingConfigs/custom:answer",
    );
  });
});

describe("parseGaepAnswerResponse", () => {
  it("extracts answer text, usage, and a compact step trace", () => {
    const result = parseGaepAnswerResponse(
      {
        answer: {
          answerText: "Use Cloud Run for the shim.",
          usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 7 },
          steps: [
            {
              state: "SUCCEEDED",
              description: "Rephrase the query and search.",
              actions: [
                {
                  searchAction: { query: "Cloud Run service shim" },
                  observation: {
                    searchResults: [
                      {
                        snippetInfo: [{ snippet: "Cloud Run can host containers." }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
      "Which runtime?",
    );

    expect(result).toEqual({
      output: "Use Cloud Run for the shim.",
      input_tokens: 42,
      output_tokens: 7,
      step_trace: {
        total_steps: 1,
        tool_call_count: 1,
        steps: [
          {
            index: 0,
            state: "SUCCEEDED",
            description: "Rephrase the query and search.",
            actions: [
              {
                tool: "search",
                query: "Cloud Run service shim",
                observation: "Cloud Run can host containers.",
              },
            ],
          },
        ],
      },
    });
  });

  it("falls back to deterministic token estimates when the API omits usage metadata", () => {
    const result = parseGaepAnswerResponse(
      {
        answer: {
          answerText: "abcd efgh",
          steps: [],
        },
      },
      "abcd",
    );

    expect(result.input_tokens).toBe(1);
    expect(result.output_tokens).toBe(3);
    expect(result.step_trace).toEqual({ total_steps: 0, tool_call_count: 0, steps: [] });
  });
});

describe("createGaepRuntimeClient", () => {
  it("calls the Discovery Engine answer endpoint with a coordinator task prompt", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createGaepRuntimeClient({
      agentResourceName: "projects/p/locations/global/collections/default_collection/engines/app",
      accessTokenProvider: async () => "token-1",
      apiEndpoint: "https://example.test/v1",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            answer: {
              answerText: "done",
              usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await client.execute({
      task_id: "task-123",
      spec: { prompt: "summarize this" },
    });

    expect(result.output).toBe("done");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://example.test/v1/projects/p/locations/global/collections/default_collection/engines/app/servingConfigs/default_search:answer",
    );
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: "Bearer token-1",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      query: { text: "summarize this" },
      userPseudoId: "agent-tasker-task-123",
      answerGenerationSpec: {
        promptSpec: {
          preamble: expect.stringContaining("readonly_http_fetch"),
        },
      },
    });
  });
});

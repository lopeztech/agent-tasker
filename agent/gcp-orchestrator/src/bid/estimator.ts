import { z } from "zod";
import { VertexAI, type GenerativeModel } from "@google-cloud/vertexai";
import type { TaskSpec } from "@agent-tasker/protocol";

export interface OrchestratorTokenEstimate {
  input_tokens: number;
  output_tokens: number;
  steps: number;
  tool_calls: number;
}

export interface BidEstimator {
  estimate(spec: TaskSpec): Promise<OrchestratorTokenEstimate>;
}

export interface GenerativeJsonClient {
  generateJson(prompt: string): Promise<unknown>;
}

const EstimateResultSchema = z.object({
  est_steps: z.number().int().positive(),
  est_tool_calls: z.number().int().nonnegative(),
  est_input_tokens_per_step: z.number().int().nonnegative(),
  est_output_tokens_per_step: z.number().int().nonnegative(),
  est_tool_call_input_tokens: z.number().int().nonnegative(),
  est_platform_overhead_output_token_equivalent: z.number().int().nonnegative().default(0),
});

const ESTIMATE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    est_steps: { type: "integer", minimum: 1 },
    est_tool_calls: { type: "integer", minimum: 0 },
    est_input_tokens_per_step: { type: "integer", minimum: 0 },
    est_output_tokens_per_step: { type: "integer", minimum: 0 },
    est_tool_call_input_tokens: { type: "integer", minimum: 0 },
    est_platform_overhead_output_token_equivalent: { type: "integer", minimum: 0 },
  },
  required: [
    "est_steps",
    "est_tool_calls",
    "est_input_tokens_per_step",
    "est_output_tokens_per_step",
    "est_tool_call_input_tokens",
  ],
} as const;

function buildPrompt(spec: TaskSpec): string {
  return `You estimate cost for a Gemini Enterprise Agent Platform orchestrator.

The executor is a multi-step GAEP runtime over Gemini 2.5 Pro plus registered tools.
Estimate the likely number of reasoning/tool steps and token usage. Do not solve the task.

Task prompt:
---
${spec.prompt}
---
${spec.min_tier ? `Minimum tier requested by client: ${spec.min_tier}\n` : ""}${
    spec.attachments?.length
      ? `Attachments: ${spec.attachments.length} (referenced by content hash; tools may need to fetch them)\n`
      : ""
  }
Return JSON with conservative integer estimates:
- est_steps: total GAEP reasoning steps, minimum 1
- est_tool_calls: total tool invocations across the run
- est_input_tokens_per_step: average input tokens per GAEP step
- est_output_tokens_per_step: average output tokens per GAEP step
- est_tool_call_input_tokens: extra input tokens per tool call for tool results/context
- est_platform_overhead_output_token_equivalent: optional GAEP platform overhead expressed as output-token-equivalent units`;
}

export class OrchestratorBidEstimator implements BidEstimator {
  constructor(private readonly client: GenerativeJsonClient) {}

  async estimate(spec: TaskSpec): Promise<OrchestratorTokenEstimate> {
    const raw = await this.client.generateJson(buildPrompt(spec));
    const parsed = EstimateResultSchema.parse(raw);
    return {
      steps: parsed.est_steps,
      tool_calls: parsed.est_tool_calls,
      input_tokens:
        parsed.est_steps * parsed.est_input_tokens_per_step +
        parsed.est_tool_calls * parsed.est_tool_call_input_tokens,
      output_tokens:
        parsed.est_steps * parsed.est_output_tokens_per_step +
        parsed.est_platform_overhead_output_token_equivalent,
    };
  }
}

export interface VertexJsonClientOptions {
  project: string;
  location: string;
  model: string;
}

export function createVertexJsonClient(opts: VertexJsonClientOptions): GenerativeJsonClient {
  const vertex = new VertexAI({ project: opts.project, location: opts.location });
  const model: GenerativeModel = vertex.getGenerativeModel({ model: opts.model });

  return {
    async generateJson(prompt: string): Promise<unknown> {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          // @ts-expect-error responseSchema typing in the Vertex SDK is
          // loose; we pass our concrete object literal directly.
          responseSchema: ESTIMATE_RESPONSE_SCHEMA,
        },
      });
      const candidate = result.response.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Vertex AI Gemini Flash returned no text");
      return JSON.parse(text);
    },
  };
}

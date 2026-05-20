import { z } from "zod";
import { VertexAI, type GenerativeModel } from "@google-cloud/vertexai";
import type { TaskSpec } from "@agent-tasker/protocol";

// Estimator interface decouples the bid handler from any single LLM SDK.
// VertexBidEstimator is the production wiring; tests inject a fake that
// returns canned token counts so they don't need network or credentials.
export interface BidEstimator {
  estimate(spec: TaskSpec): Promise<{ input_tokens: number; output_tokens: number }>;
}

// Minimal surface VertexBidEstimator needs from a generative model client.
// One method: send a prompt, get back parsed JSON. Tests stub this
// directly without touching @google-cloud/vertexai.
export interface GenerativeJsonClient {
  generateJson(prompt: string): Promise<unknown>;
}

const EstimateResultSchema = z.object({
  est_input_tokens: z.number().int().nonnegative(),
  est_output_tokens: z.number().int().nonnegative(),
});

// JSON schema fed to Gemini's `responseSchema` so it returns structured
// output rather than free-form prose we'd then have to parse.
const ESTIMATE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    est_input_tokens: { type: "integer", minimum: 0 },
    est_output_tokens: { type: "integer", minimum: 0 },
  },
  required: ["est_input_tokens", "est_output_tokens"],
} as const;

function buildPrompt(spec: TaskSpec): string {
  // Keep the prompt tight — bid-phase tokens count against the per-task
  // cost floor and Gemini Flash is the cheapest in the family. CLAUDE.md
  // pegs the whole bid round at ~$0.0004 total across all four agents.
  return `You estimate token cost for another model (Gemini 2.5 Pro) to complete a task.

Task prompt:
---
${spec.prompt}
---
${spec.min_tier ? `Minimum tier requested by client: ${spec.min_tier}\n` : ""}${
    spec.attachments?.length
      ? `Attachments: ${spec.attachments.length} (referenced by content hash; agent must fetch if it bids)\n`
      : ""
  }
Return JSON with conservative integer estimates:
- est_input_tokens: tokens the prompt + system context + any tool calls would consume on input
- est_output_tokens: tokens the model's response would generate`;
}

export class VertexBidEstimator implements BidEstimator {
  constructor(private readonly client: GenerativeJsonClient) {}

  async estimate(spec: TaskSpec): Promise<{ input_tokens: number; output_tokens: number }> {
    const raw = await this.client.generateJson(buildPrompt(spec));
    const parsed = EstimateResultSchema.parse(raw);
    return {
      input_tokens: parsed.est_input_tokens,
      output_tokens: parsed.est_output_tokens,
    };
  }
}

// Production wiring: returns a GenerativeJsonClient backed by Vertex AI
// Gemini Flash. The handler PR keeps this thin so the bulk of the bid
// logic stays under unit test.
export interface VertexJsonClientOptions {
  project: string;
  location: string;
  model: string; // e.g. "gemini-2.5-flash"
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

import { z } from "zod";
import type { TaskSpec } from "@agent-tasker/protocol";

export interface BidEstimator {
  estimate(spec: TaskSpec): Promise<{ input_tokens: number; output_tokens: number }>;
}

export interface GenerativeJsonClient {
  generateJson(prompt: string): Promise<unknown>;
}

const EstimateResultSchema = z.object({
  est_input_tokens: z.number().int().nonnegative(),
  est_output_tokens: z.number().int().nonnegative(),
});

function buildPrompt(spec: TaskSpec): string {
  return `You estimate token cost for another model (GPT-5) to complete a task.

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

export class AzureOpenAiBidEstimator implements BidEstimator {
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

export interface AzureOpenAiJsonClientOptions {
  endpoint: string;
  deployment: string;
  apiKey: string;
  apiVersion: string;
}

export function createAzureOpenAiJsonClient(
  opts: AzureOpenAiJsonClientOptions,
): GenerativeJsonClient {
  const endpoint = opts.endpoint.replace(/\/$/, "");
  const url = new URL(
    `${endpoint}/openai/deployments/${encodeURIComponent(opts.deployment)}/chat/completions`,
  );
  url.searchParams.set("api-version", opts.apiVersion);

  return {
    async generateJson(prompt: string): Promise<unknown> {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "api-key": opts.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: "Return only JSON matching the requested shape.",
            },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        throw new Error(`Azure OpenAI bid estimate failed with HTTP ${response.status}`);
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("Azure OpenAI returned no estimate content");
      return JSON.parse(content);
    },
  };
}

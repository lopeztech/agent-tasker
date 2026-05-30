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

export function buildNovaBidPrompt(spec: TaskSpec): string {
  return `You estimate Amazon Nova Pro token usage for a sealed-bid agent market.

Use Nova-family tokenization behavior, not Claude, Gemini, or GPT examples. Be conservative: code, JSON, YAML, URLs, tables, long identifiers, and punctuation-heavy text generally tokenize denser than plain prose. Attachments are referenced by hash; count only metadata unless the task requires fetching or reading them, then budget the likely retrieved text as input.

Examples calibrated for Nova-style bids:
- "Summarize this 900-word product memo in five bullets" -> {"est_input_tokens":1400,"est_output_tokens":220}
- "Review this TypeScript function and return fixed code" with a 120-line snippet -> {"est_input_tokens":2600,"est_output_tokens":900}
- "Compare three attached policy PDFs and cite conflicts" with attachment hashes only -> {"est_input_tokens":8000,"est_output_tokens":1600}

Task prompt:
---
${spec.prompt}
---
${spec.min_tier ? `Minimum tier requested by client: ${spec.min_tier}\n` : ""}${
    spec.attachments?.length
      ? `Attachments: ${spec.attachments.length} hash reference(s); include fetch/read budget only if needed by the prompt.\n`
      : ""
  }
Return only JSON:
{"est_input_tokens": integer, "est_output_tokens": integer}`;
}

export class NovaBidEstimator implements BidEstimator {
  constructor(private readonly client: GenerativeJsonClient) {}

  async estimate(spec: TaskSpec): Promise<{ input_tokens: number; output_tokens: number }> {
    const raw = await this.client.generateJson(buildNovaBidPrompt(spec));
    const parsed = EstimateResultSchema.parse(raw);
    return {
      input_tokens: parsed.est_input_tokens,
      output_tokens: parsed.est_output_tokens,
    };
  }
}

export interface BedrockNovaJsonClientOptions {
  region: string;
  modelId: string;
}

// Bedrock-backed GenerativeJsonClient for the bid estimator. Uses Nova Micro
// for low-cost bid calls; parses the first JSON object from the response text.
export function createBedrockNovaJsonClient(
  opts: BedrockNovaJsonClientOptions,
): GenerativeJsonClient {
  return {
    async generateJson(prompt: string): Promise<unknown> {
      const { BedrockRuntimeClient, InvokeModelCommand } =
        await import("@aws-sdk/client-bedrock-runtime");
      const client = new BedrockRuntimeClient({ region: opts.region });
      const command = new InvokeModelCommand({
        modelId: opts.modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          messages: [{ role: "user", content: [{ text: prompt }] }],
          inferenceConfig: { maxTokens: 256, temperature: 0.1 },
        }),
      });
      const response = await client.send(command);
      const bodyText =
        typeof response.body === "string" ? response.body : new TextDecoder().decode(response.body);
      const body = JSON.parse(bodyText) as {
        output?: { message?: { content?: Array<{ text?: string }> } };
      };
      const text = body.output?.message?.content
        ?.map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!text) throw new Error("Nova bid response empty");
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error(`Nova bid response contains no JSON: ${text}`);
      return JSON.parse(match[0]) as unknown;
    },
  };
}

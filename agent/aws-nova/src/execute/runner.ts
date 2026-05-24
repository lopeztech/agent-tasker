import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

export interface GenerativeTextClient {
  generate(prompt: string): Promise<{
    output: string;
    input_tokens: number;
    output_tokens: number;
  }>;
}

export interface BedrockRuntimeClientLike {
  send(command: InvokeModelCommand): Promise<{ body?: Uint8Array | string }>;
}

export interface BedrockNovaTextClientOptions {
  region: string;
  modelId: string;
  maxTokens?: number;
  temperature?: number;
  client?: BedrockRuntimeClientLike;
}

function decodeBody(body: Uint8Array | string | undefined): unknown {
  if (body === undefined) throw new Error("Bedrock Nova execute response missing body");
  const text = typeof body === "string" ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

export function createBedrockNovaTextClient(
  opts: BedrockNovaTextClientOptions,
): GenerativeTextClient {
  const client = opts.client ?? new BedrockRuntimeClient({ region: opts.region });

  return {
    async generate(prompt: string) {
      const command = new InvokeModelCommand({
        modelId: opts.modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          messages: [{ role: "user", content: [{ text: prompt }] }],
          inferenceConfig: {
            maxTokens: opts.maxTokens ?? 4096,
            temperature: opts.temperature ?? 0.2,
          },
        }),
      });

      const response = await client.send(command);
      const body = decodeBody(response.body) as {
        output?: { message?: { content?: Array<{ text?: string }> } };
        usage?: { inputTokens?: number; outputTokens?: number };
      };

      const output = body.output?.message?.content
        ?.map((part) => part.text ?? "")
        .join("")
        .trim();
      if (!output) throw new Error("Bedrock Nova returned no execute content");
      if (!body.usage) throw new Error("Bedrock Nova execute response missing usage");

      return {
        output,
        input_tokens: body.usage.inputTokens ?? 0,
        output_tokens: body.usage.outputTokens ?? 0,
      };
    },
  };
}

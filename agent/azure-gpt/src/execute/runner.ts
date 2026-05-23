export interface GenerativeTextClient {
  generate(prompt: string): Promise<{
    output: string;
    input_tokens: number;
    output_tokens: number;
  }>;
}

export interface AzureOpenAiTextClientOptions {
  endpoint: string;
  deployment: string;
  apiKey: string;
  apiVersion: string;
}

export function createAzureOpenAiTextClient(
  opts: AzureOpenAiTextClientOptions,
): GenerativeTextClient {
  const endpoint = opts.endpoint.replace(/\/$/, "");
  const url = new URL(
    `${endpoint}/openai/deployments/${encodeURIComponent(opts.deployment)}/chat/completions`,
  );
  url.searchParams.set("api-version", opts.apiVersion);

  return {
    async generate(prompt: string) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "api-key": opts.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Azure OpenAI execute failed with HTTP ${response.status}`);
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const output = body.choices?.[0]?.message?.content;
      if (output === undefined || output === null) {
        throw new Error("Azure OpenAI returned no execute content");
      }
      if (!body.usage) {
        throw new Error("Azure OpenAI execute response missing usage");
      }

      return {
        output,
        input_tokens: body.usage.prompt_tokens ?? 0,
        output_tokens: body.usage.completion_tokens ?? 0,
      };
    },
  };
}

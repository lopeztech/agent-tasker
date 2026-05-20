import { VertexAI, type GenerativeModel } from "@google-cloud/vertexai";

// Minimal surface the handler needs from the underlying model client.
// Production wires this against @google-cloud/vertexai; tests inject a
// stub that returns canned output + usage so they don't need network.
export interface GenerativeTextClient {
  generate(prompt: string): Promise<{
    output: string;
    input_tokens: number;
    output_tokens: number;
  }>;
}

export interface VertexTextClientOptions {
  project: string;
  location: string;
  model: string; // e.g. "gemini-2.5-pro"
}

// Production wiring: direct single-call to Gemini 2.5 Pro. No tool use,
// no multi-step orchestration — that's the orchestrator agent's
// (#90-#95) job. CLAUDE.md → Per-cloud agent implementation pins this
// agent to the direct SDK only.
export function createVertexTextClient(opts: VertexTextClientOptions): GenerativeTextClient {
  const vertex = new VertexAI({ project: opts.project, location: opts.location });
  const model: GenerativeModel = vertex.getGenerativeModel({ model: opts.model });

  return {
    async generate(prompt: string) {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const candidate = result.response.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text;
      if (text === undefined) {
        throw new Error("Vertex AI Gemini 2.5 Pro returned no text");
      }
      const usage = result.response.usageMetadata;
      if (!usage) {
        throw new Error("Vertex AI response missing usageMetadata");
      }
      return {
        output: text,
        input_tokens: usage.promptTokenCount ?? 0,
        output_tokens: usage.candidatesTokenCount ?? 0,
      };
    },
  };
}

import { describe, expect, it } from "vitest";
import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  createBedrockNovaTextClient,
  type BedrockRuntimeClientLike,
} from "../../src/execute/runner.js";

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("createBedrockNovaTextClient", () => {
  it("invokes Nova Pro and maps output plus usage", async () => {
    let commandInput: InvokeModelCommand["input"] | undefined;
    const bedrock: BedrockRuntimeClientLike = {
      async send(command) {
        commandInput = command.input;
        return {
          body: encodeJson({
            output: { message: { content: [{ text: "completed output" }] } },
            usage: { inputTokens: 321, outputTokens: 98 },
          }),
        };
      },
    };

    const client = createBedrockNovaTextClient({
      region: "us-east-1",
      modelId: "amazon.nova-pro-v1:0",
      client: bedrock,
    });

    await expect(client.generate("do the work")).resolves.toEqual({
      output: "completed output",
      input_tokens: 321,
      output_tokens: 98,
    });

    expect(commandInput?.modelId).toBe("amazon.nova-pro-v1:0");
    expect(commandInput?.contentType).toBe("application/json");
    expect(commandInput?.accept).toBe("application/json");
    const rawBody = commandInput?.body;
    const requestBody = JSON.parse(
      typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody as Uint8Array),
    );
    expect(requestBody.messages).toEqual([{ role: "user", content: [{ text: "do the work" }] }]);
    expect(requestBody.inferenceConfig.maxTokens).toBe(4096);
  });

  it("throws when the response body is missing", async () => {
    const bedrock: BedrockRuntimeClientLike = {
      async send() {
        return {};
      },
    };
    const client = createBedrockNovaTextClient({
      region: "us-east-1",
      modelId: "amazon.nova-pro-v1:0",
      client: bedrock,
    });

    await expect(client.generate("do the work")).rejects.toThrow(
      /Bedrock Nova execute response missing body/,
    );
  });

  it("throws when usage is missing", async () => {
    const bedrock: BedrockRuntimeClientLike = {
      async send() {
        return {
          body: encodeJson({
            output: { message: { content: [{ text: "ok" }] } },
          }),
        };
      },
    };
    const client = createBedrockNovaTextClient({
      region: "us-east-1",
      modelId: "amazon.nova-pro-v1:0",
      client: bedrock,
    });

    await expect(client.generate("do the work")).rejects.toThrow(
      /Bedrock Nova execute response missing usage/,
    );
  });
});

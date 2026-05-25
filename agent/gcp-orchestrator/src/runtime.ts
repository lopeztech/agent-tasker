import type { ExecuteRequest, Result, StepTrace } from "@agent-tasker/protocol";
import { AGENT_ID } from "./index.js";

export interface GaepRuntimeResult {
  output: string;
  input_tokens: number;
  output_tokens: number;
  step_trace?: StepTrace;
}

export interface GaepRuntimeClient {
  execute(req: ExecuteRequest): Promise<GaepRuntimeResult>;
}

export interface GaepRuntimeClientOptions {
  agentResourceName: string | undefined;
  accessTokenProvider?: AccessTokenProvider;
  fetch?: typeof fetch;
  apiEndpoint?: string;
}

export type AccessTokenProvider = () => Promise<string>;

export function createGaepRuntimeClient(opts: GaepRuntimeClientOptions): GaepRuntimeClient {
  const agentResourceName = opts.agentResourceName?.trim();
  const fetchImpl = opts.fetch ?? fetch;
  const accessTokenProvider = opts.accessTokenProvider ?? fetchMetadataAccessToken;
  const apiEndpoint = opts.apiEndpoint ?? "https://discoveryengine.googleapis.com/v1";

  return {
    async execute(req: ExecuteRequest): Promise<GaepRuntimeResult> {
      if (!agentResourceName) {
        throw new Error("GAEP agent resource name is required before execution can run");
      }
      const accessToken = await accessTokenProvider();
      const response = await fetchImpl(buildAnswerUrl(apiEndpoint, agentResourceName), {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: { text: req.spec.prompt },
          userPseudoId: `agent-tasker-${req.task_id}`,
        }),
      });
      if (!response.ok) {
        throw new Error(`GAEP answer call failed with HTTP ${response.status}`);
      }
      const body = (await response.json()) as unknown;
      return parseGaepAnswerResponse(body, req.spec.prompt);
    },
  };
}

export async function executeViaGaep(
  req: ExecuteRequest,
  client: GaepRuntimeClient,
): Promise<Result> {
  const result = await client.execute(req);
  return {
    task_id: req.task_id,
    agent_id: AGENT_ID,
    output: result.output,
    actual_usage: {
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
    },
    ...(result.step_trace ? { step_trace: result.step_trace } : {}),
  };
}

export function buildAnswerUrl(apiEndpoint: string, agentResourceName: string): string {
  const base = apiEndpoint.replace(/\/$/, "");
  const servingConfig = agentResourceName.includes("/servingConfigs/")
    ? agentResourceName
    : `${agentResourceName.replace(/\/$/, "")}/servingConfigs/default_search`;
  return `${base}/${servingConfig}:answer`;
}

export async function fetchMetadataAccessToken(): Promise<string> {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "metadata-flavor": "Google" } },
  );
  if (!response.ok) {
    throw new Error(`metadata token fetch failed with HTTP ${response.status}`);
  }
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new Error("metadata token response missing access_token");
  }
  return body.access_token;
}

export function parseGaepAnswerResponse(body: unknown, prompt: string): GaepRuntimeResult {
  const record = asRecord(body);
  const answer = asRecord(record["answer"]);
  const output = stringValue(answer["answerText"]) ?? stringValue(record["answerText"]);
  if (output === undefined) {
    throw new Error("GAEP answer response missing answer.answerText");
  }

  const stepTrace = parseStepTrace(answer["steps"]);
  const usage = parseUsage(record, answer, prompt, output);
  return {
    output,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    ...(stepTrace ? { step_trace: stepTrace } : {}),
  };
}

function parseStepTrace(rawSteps: unknown): StepTrace | undefined {
  if (!Array.isArray(rawSteps)) return undefined;

  const steps = rawSteps.map((rawStep, index) => {
    const step = asRecord(rawStep);
    const actions = Array.isArray(step["actions"]) ? step["actions"] : [];
    return {
      index,
      ...(stringValue(step["state"]) ? { state: stringValue(step["state"]) } : {}),
      ...(stringValue(step["description"])
        ? { description: stringValue(step["description"]) }
        : {}),
      actions: actions.map(parseStepAction),
    };
  });

  return {
    total_steps: steps.length,
    tool_call_count: steps.reduce((count, step) => count + step.actions.length, 0),
    steps,
  };
}

function parseStepAction(rawAction: unknown): StepTrace["steps"][number]["actions"][number] {
  const action = asRecord(rawAction);
  const searchAction = asRecord(action["searchAction"]);
  const observation = asRecord(action["observation"]);
  const searchResults = Array.isArray(observation["searchResults"])
    ? observation["searchResults"]
    : [];
  const firstResult = asRecord(searchResults[0]);
  const snippetInfo = Array.isArray(firstResult["snippetInfo"]) ? firstResult["snippetInfo"] : [];
  const firstSnippet = asRecord(snippetInfo[0]);
  return {
    tool: searchAction["query"] === undefined ? "gaep_action" : "search",
    ...(stringValue(searchAction["query"]) ? { query: stringValue(searchAction["query"]) } : {}),
    ...(stringValue(firstSnippet["snippet"])
      ? { observation: stringValue(firstSnippet["snippet"]) }
      : {}),
  };
}

function parseUsage(
  response: Record<string, unknown>,
  answer: Record<string, unknown>,
  prompt: string,
  output: string,
): { input_tokens: number; output_tokens: number } {
  const answerUsage = asRecord(answer["usageMetadata"]);
  const responseUsage = asRecord(response["usageMetadata"]);
  const usage = Object.keys(answerUsage).length > 0 ? answerUsage : responseUsage;
  // The Answer API examples omit usage metadata, so keep settlement moving
  // with a deterministic fallback until GAEP exposes exact token counts.
  const input =
    numberValue(usage?.["promptTokenCount"]) ??
    numberValue(usage?.["inputTokenCount"]) ??
    estimateTokens(prompt);
  const outputTokens =
    numberValue(usage?.["candidatesTokenCount"]) ??
    numberValue(usage?.["outputTokenCount"]) ??
    numberValue(usage?.["answerTokenCount"]) ??
    estimateTokens(output);
  return { input_tokens: input, output_tokens: outputTokens };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(new TextEncoder().encode(text).byteLength / 4));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

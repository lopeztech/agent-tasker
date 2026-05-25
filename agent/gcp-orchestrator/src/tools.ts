export interface OrchestratorToolDefinition {
  id: string;
  display_name: string;
  purpose: string;
  input_contract: string;
  guardrails: readonly string[];
}

export const INITIAL_TOOL_SURFACE: readonly OrchestratorToolDefinition[] = [
  {
    id: "readonly_http_fetch",
    display_name: "Read-only HTTP fetch",
    purpose: "Fetch public HTTP(S) resources needed to answer the task.",
    input_contract: "url: HTTPS URL; method: GET or HEAD; max_bytes: optional byte cap",
    guardrails: [
      "Only GET and HEAD are allowed.",
      "Do not send credentials, cookies, secrets, or task JWTs to fetched URLs.",
      "Prefer signed attachment URLs supplied by the coordinator over arbitrary URLs.",
      "Stop after the configured byte cap and summarize partial content explicitly.",
    ],
  },
  {
    id: "search_retrieval",
    display_name: "Search and retrieval",
    purpose: "Retrieve relevant public or configured corpus snippets before synthesis.",
    input_contract: "query: natural-language search query; max_results: bounded integer",
    guardrails: [
      "Use when the task requires current or external facts.",
      "Cite retrieved source titles or URLs in the answer when available.",
      "Do not expand the search scope beyond the task request.",
    ],
  },
  {
    id: "code_eval_sandbox",
    display_name: "Code evaluation sandbox",
    purpose: "Run small deterministic snippets to inspect data or verify calculations.",
    input_contract: "language: supported runtime; code: short snippet; timeout_ms: bounded integer",
    guardrails: [
      "No network access from evaluated code.",
      "No filesystem writes outside the sandbox workspace.",
      "Use only for deterministic calculation, parsing, or validation steps.",
      "Respect CPU, memory, and wall-clock limits.",
    ],
  },
] as const;

export function buildToolSurfacePreamble(
  tools: readonly OrchestratorToolDefinition[] = INITIAL_TOOL_SURFACE,
): string {
  const renderedTools = tools
    .map(
      (tool) =>
        `- ${tool.id} (${tool.display_name}): ${tool.purpose}\n  Input: ${
          tool.input_contract
        }\n  Guardrails: ${tool.guardrails.join(" ")}`,
    )
    .join("\n");

  return `You are the GCP/Orchestrator agent for Agent Tasker. Use only the registered GAEP tools listed below, and only when they materially improve the answer.

Registered tool surface:
${renderedTools}

Keep the plan narrow. Prefer the fewest tool calls that can complete the task, and include enough final context for audit replay.`;
}

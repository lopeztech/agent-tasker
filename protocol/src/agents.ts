import { z } from "zod";

export const AGENT_IDS = ["aws-nova", "azure-gpt", "gcp-gemini", "gcp-orchestrator"] as const;
export const AgentIdSchema = z.enum(AGENT_IDS);
export type AgentId = z.infer<typeof AgentIdSchema>;

export const MODEL_FAMILIES = ["gemini", "gpt", "nova"] as const;
export const ModelFamilySchema = z.enum(MODEL_FAMILIES);
export type ModelFamily = z.infer<typeof ModelFamilySchema>;

// Both GCP agents resolve to the Gemini model family — they contrast on
// runtime/capability (direct Vertex SDK vs Gemini Enterprise Agent Platform),
// not on the underlying LLM. See CLAUDE.md → Per-cloud agent implementation.
export const AGENT_MODEL_FAMILY: Record<AgentId, ModelFamily> = {
  "aws-nova": "nova",
  "azure-gpt": "gpt",
  "gcp-gemini": "gemini",
  "gcp-orchestrator": "gemini",
};

import { z } from "zod";

export const AGENT_IDS = ["aws-claude", "aws-nova", "azure-gpt", "gcp-gemini"] as const;
export const AgentIdSchema = z.enum(AGENT_IDS);
export type AgentId = z.infer<typeof AgentIdSchema>;

export const MODEL_FAMILIES = ["claude", "nova", "gpt", "gemini"] as const;
export const ModelFamilySchema = z.enum(MODEL_FAMILIES);
export type ModelFamily = z.infer<typeof ModelFamilySchema>;

export const AGENT_MODEL_FAMILY: Record<AgentId, ModelFamily> = {
  "aws-claude": "claude",
  "aws-nova": "nova",
  "azure-gpt": "gpt",
  "gcp-gemini": "gemini",
};

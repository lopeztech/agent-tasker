import { z } from "zod";
import type { AgentId } from "./agents.js";

export const TIERS = ["small", "medium", "frontier"] as const;
export const TierSchema = z.enum(TIERS);
export type Tier = z.infer<typeof TierSchema>;

const TIER_RANK: Record<Tier, number> = {
  small: 0,
  medium: 1,
  frontier: 2,
};

export function compareTier(a: Tier, b: Tier): number {
  return TIER_RANK[a] - TIER_RANK[b];
}

export function meetsMinTier(bidTier: Tier, minTier: Tier | undefined): boolean {
  if (minTier === undefined) return true;
  return TIER_RANK[bidTier] >= TIER_RANK[minTier];
}

// Reference mapping of canonical model IDs per (agent, tier). Documentation
// only — actual deploys pin model_id via Terraform/env per CLAUDE.md.
// `null` means the family has no offering at that tier and the agent must
// decline-to-bid (`capability`) if min_tier matches that slot.
export const CANONICAL_TIER_MODELS: Record<AgentId, Record<Tier, string | null>> = {
  "aws-nova": {
    small: "amazon.nova-micro",
    medium: "amazon.nova-lite",
    frontier: "amazon.nova-pro",
  },
  "azure-gpt": {
    small: "gpt-5-mini",
    medium: null,
    frontier: "gpt-5",
  },
  "gcp-gemini": {
    small: "gemini-2-5-flash",
    medium: null,
    frontier: "gemini-2-5-pro",
  },
  // GAEP-backed orchestrator. Bid LLM is Gemini Flash; execution is a
  // GAEP composite over Gemini 2.5 Pro. Bids declare `frontier` since the
  // underlying execution model is Pro-class — competitive advantage is in
  // the runtime layer, not raw model quality. See CLAUDE.md → Quality floor.
  "gcp-orchestrator": {
    small: "gemini-2-5-flash",
    medium: null,
    frontier: "gemini-2-5-pro",
  },
};

import { z } from "zod";

export const PricingEntrySchema = z.object({
  model_id: z.string().min(1),
  price_in_usd_per_mtoken: z.number().nonnegative(),
  price_out_usd_per_mtoken: z.number().nonnegative(),
  effective_date: z.string().date(),
});
export type PricingEntry = z.infer<typeof PricingEntrySchema>;

// Last-resort fallback prices, used only when the daily refresh job AND its
// last-known-good cache are both unavailable (see CLAUDE.md → Pricing data).
// These are conservative published-list-price snapshots and MUST be verified
// before being relied on; the daily refresh in DynamoDB is the source of
// truth. Quarterly review tracked by issue #41.
// Units: USD per 1,000,000 tokens.
export const FALLBACK_PRICING: Record<string, PricingEntry> = {
  // AWS Bedrock — Anthropic
  "anthropic.claude-haiku-3-5": {
    model_id: "anthropic.claude-haiku-3-5",
    price_in_usd_per_mtoken: 0.8,
    price_out_usd_per_mtoken: 4.0,
    effective_date: "2026-05-15",
  },
  "anthropic.claude-sonnet-4-6": {
    model_id: "anthropic.claude-sonnet-4-6",
    price_in_usd_per_mtoken: 3.0,
    price_out_usd_per_mtoken: 15.0,
    effective_date: "2026-05-15",
  },

  // AWS Bedrock — Amazon Nova
  "amazon.nova-micro": {
    model_id: "amazon.nova-micro",
    price_in_usd_per_mtoken: 0.035,
    price_out_usd_per_mtoken: 0.14,
    effective_date: "2026-05-15",
  },
  "amazon.nova-lite": {
    model_id: "amazon.nova-lite",
    price_in_usd_per_mtoken: 0.06,
    price_out_usd_per_mtoken: 0.24,
    effective_date: "2026-05-15",
  },
  "amazon.nova-pro": {
    model_id: "amazon.nova-pro",
    price_in_usd_per_mtoken: 0.8,
    price_out_usd_per_mtoken: 3.2,
    effective_date: "2026-05-15",
  },

  // Azure OpenAI
  "gpt-5-mini": {
    model_id: "gpt-5-mini",
    price_in_usd_per_mtoken: 0.25,
    price_out_usd_per_mtoken: 2.0,
    effective_date: "2026-05-15",
  },
  "gpt-5": {
    model_id: "gpt-5",
    price_in_usd_per_mtoken: 1.25,
    price_out_usd_per_mtoken: 10.0,
    effective_date: "2026-05-15",
  },

  // GCP Vertex AI
  "gemini-2-5-flash": {
    model_id: "gemini-2-5-flash",
    price_in_usd_per_mtoken: 0.3,
    price_out_usd_per_mtoken: 2.5,
    effective_date: "2026-05-15",
  },
  "gemini-2-5-pro": {
    model_id: "gemini-2-5-pro",
    price_in_usd_per_mtoken: 1.25,
    price_out_usd_per_mtoken: 10.0,
    effective_date: "2026-05-15",
  },
};

// Compute bid_usd identically across all four agents. Pure function so the
// coordinator can re-derive it from a bid record for audit replay.
export function computeBidUsd(params: {
  est_input_tokens: number;
  est_output_tokens: number;
  price_in_usd_per_mtoken: number;
  price_out_usd_per_mtoken: number;
}): number {
  return (
    (params.est_input_tokens / 1_000_000) * params.price_in_usd_per_mtoken +
    (params.est_output_tokens / 1_000_000) * params.price_out_usd_per_mtoken
  );
}

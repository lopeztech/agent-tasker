import {
  computeBidUsd,
  type AnnounceRequest,
  type Bid,
  type BidResponse,
  type PricingEntry,
} from "@agent-tasker/protocol";
import type { BidEstimator } from "./estimator.js";

// Identity of this agent. Locked at the package level — the deployment shape
// (per-project SA, per-service IAM Condition) enforces that this agent only
// ever serves as "gcp-gemini"; the constant just keeps the bid envelope
// honest.
export const AGENT_ID = "gcp-gemini" as const;

// Per CLAUDE.md → Per-cloud agent implementation: GCP/Gemini executes via
// Gemini 2.5 Pro direct (no orchestration). Pinned per deployment, not in
// code, but exposed here as the bid envelope's `model_id` for audit.
export const EXECUTION_MODEL_ID = "gemini-2-5-pro";
export const EXECUTION_MODEL_FAMILY = "gemini" as const;
export const EXECUTION_TIER = "frontier" as const;

// Validity window placed on each bid. CLAUDE.md → bidding protocol caps the
// adaptive round at 5s; 60s gives the coordinator plenty of award headroom
// without making stale bids honor-bound.
const BID_TTL_MS = 60_000;

export interface BidHandlerDeps {
  estimator: BidEstimator;
  // Pricing for the execution model. Today comes from FALLBACK_PRICING in
  // /protocol; Firestore-sourced pricing arrives with #35–#41.
  pricing: PricingEntry;
  // Test seam — defaults to Date.now / crypto-random signature.
  now?: () => Date;
  sign?: (taskId: string) => string;
}

// Pure-of-side-effects-other-than-the-estimator handler. Hono wiring lives
// in src/app.ts (forthcoming with the Cloud Run PR #61).
export async function handleBid(req: AnnounceRequest, deps: BidHandlerDeps): Promise<BidResponse> {
  const now = deps.now?.() ?? new Date();
  try {
    const { input_tokens, output_tokens } = await deps.estimator.estimate(req.spec);
    const bidUsd = computeBidUsd({
      est_input_tokens: input_tokens,
      est_output_tokens: output_tokens,
      price_in_usd_per_mtoken: deps.pricing.price_in_usd_per_mtoken,
      price_out_usd_per_mtoken: deps.pricing.price_out_usd_per_mtoken,
    });

    const bid: Bid = {
      task_id: req.task_id,
      agent_id: AGENT_ID,
      tier: EXECUTION_TIER,
      model_family: EXECUTION_MODEL_FAMILY,
      model_id: EXECUTION_MODEL_ID,
      est_input_tokens: input_tokens,
      est_output_tokens: output_tokens,
      price_in_usd_per_mtoken: deps.pricing.price_in_usd_per_mtoken,
      price_out_usd_per_mtoken: deps.pricing.price_out_usd_per_mtoken,
      bid_usd: bidUsd,
      expires_at: new Date(now.getTime() + BID_TTL_MS).toISOString(),
      // Bid signing is a future PR — agents will run their own keypair and
      // the coordinator will verify against an agent-side JWKS. For now,
      // a stub keeps the schema satisfied and the coordinator is configured
      // not to verify bid signatures.
      signature: deps.sign?.(req.task_id) ?? "stub-signature",
    };
    return bid;
  } catch (err) {
    // Estimator failure is treated as a decline, not a hard error, so the
    // round still settles. The reason code is the protocol's
    // `internal_error`; richer diagnostic detail goes to logs (TODO with
    // #73 structured logging).
    void err;
    return {
      task_id: req.task_id,
      agent_id: AGENT_ID,
      status: "no_bid",
      reason: "internal_error",
    };
  }
}

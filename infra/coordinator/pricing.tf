# Per-model pricing table, refreshed daily by the pricing Lambda (issue #35).
#
# Item shape (see CLAUDE.md → Pricing data and /protocol PricingEntrySchema):
#
#   PK (model_id)              SK (effective_date)   attributes
#   ─────────────────────────  ───────────────────   ──────────────────────────────────
#   anthropic.claude-haiku-3-5 2026-05-15            price_in_usd_per_mtoken,
#   amazon.nova-pro            2026-05-15              price_out_usd_per_mtoken
#   gpt-5                      2026-05-15
#   gemini-2-5-pro             2026-05-15
#
# Agents read the current price at bid time with a single Query on model_id,
# sorted descending by effective_date with Limit 1 — the most recent snapshot
# on or before today wins. Keeping every effective_date as its own item gives
# last-known-good fallback for free (yesterday's row survives a failed refresh)
# and lets the coordinator replay a past auction against the exact prices that
# were live on the task's day.
resource "aws_dynamodb_table" "pricing" {
  name         = "${local.name_prefix}-pricing"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "model_id"
  range_key    = "effective_date"

  attribute {
    name = "model_id"
    type = "S"
  }

  attribute {
    name = "effective_date"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }
}

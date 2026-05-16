# Single-table ledger for the auction.
#
# Item shapes (see CLAUDE.md → Storage and /protocol schemas):
#
#   PK (task_id)         SK                      agent_id     notes
#   ────────────────     ────────────────────    ─────────    ─────────────────────────────
#   <uuid>               task                    —            task root + status
#   <uuid>               bid#aws-claude          aws-claude   per-agent bid (or no_bid)
#   <uuid>               bid#aws-nova            aws-nova
#   <uuid>               award                   <winner>     award; carries winner agent_id
#   <uuid>               reject#aws-nova         aws-nova
#   <uuid>               result#aws-claude       aws-claude   /execute output + actual_usage
#   <uuid>               settle#aws-claude       aws-claude   bookkeeping: bid vs actual MAPE
#
# The agent_id attribute is *sparse* — set only on items that belong to a
# specific agent. Coordinator-only items (the task root) omit it and are
# excluded from the GSI, which keeps per-agent scans clean.
resource "aws_dynamodb_table" "ledger" {
  name         = "${local.name_prefix}-ledger"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "task_id"
  range_key    = "sk"

  attribute {
    name = "task_id"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "agent_id"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  # Per-agent rolling stats: MAPE rollups, win rate by tier, decline rate by
  # reason. Sort by created_at so recent windows are a single Query.
  global_secondary_index {
    name            = "agent_id-created_at-index"
    hash_key        = "agent_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }
}

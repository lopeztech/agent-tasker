# Native-mode Firestore for the coordinator's ledger and the daily pricing
# snapshots. A GCP project can hold one Firestore database; we use the
# `(default)` name so future modules (pricing refresh function, eval replay,
# BigQuery export) can reference it without coordinating naming.
#
# Schema lives in code, not Terraform — only the database container and the
# composite indexes that collection-group queries require are defined here.
# Per CLAUDE.md → Storage:
#
#   tasks/{task_id}                        -- root task doc
#   tasks/{task_id}/bids/{agent_id}        -- per-agent bid records
#   tasks/{task_id}/awards/{n}             -- award + (potential) re-auctions
#   tasks/{task_id}/results/{agent_id}     -- /execute results
#   pricing/{model_id}/snapshots/{date}    -- immutable daily price snapshots
#
# Indexes target the `bids` subcollection via COLLECTION_GROUP scope so we can
# query per-agent activity across all tasks without scanning every parent.

resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  # Concurrency mode: OPTIMISTIC keeps single-document write latency low;
  # transaction conflicts surface as retryable errors in the SDK, which is the
  # right behavior for the coordinator's auction state machine.
  concurrency_mode = "OPTIMISTIC"

  delete_protection_state = var.firestore_delete_protection ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"

  # `ABANDON` means `terraform destroy` removes the resource from state but
  # leaves the database in GCP, so accidental destroys never silently delete
  # the ledger. Re-import is straightforward if state diverges.
  deletion_policy = "ABANDON"
}

# Per-agent rolling stats: read recent bids for one agent. Used for MAPE
# rollups, win-rate dashboards, decline-rate cuts.
resource "google_firestore_index" "bids_by_agent_recency" {
  project     = var.project_id
  database    = google_firestore_database.default.name
  collection  = "bids"
  query_scope = "COLLECTION_GROUP"

  fields {
    field_path = "agent_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "timestamp"
    order      = "DESCENDING"
  }
}

# Per-(agent, phase) cuts so decline-rate by reason and bid-vs-no_bid splits
# don't pay for a full scan + in-memory filter on every dashboard refresh.
resource "google_firestore_index" "bids_by_agent_phase_recency" {
  project     = var.project_id
  database    = google_firestore_database.default.name
  collection  = "bids"
  query_scope = "COLLECTION_GROUP"

  fields {
    field_path = "agent_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "phase"
    order      = "ASCENDING"
  }
  fields {
    field_path = "timestamp"
    order      = "DESCENDING"
  }
}

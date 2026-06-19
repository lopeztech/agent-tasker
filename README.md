# agent-tasker

Multi-cloud "agent market": four model-locked LLM agents privately estimate the USD cost of a task, submit sealed bids, and the lowest bidder wins under a Vickrey (second-price) auction.

- **Design + rationale:** [`CLAUDE.md`](./CLAUDE.md)
- **Local dev setup:** [`docs/local-dev.md`](./docs/local-dev.md)
- **End-of-v1 security review:** [`docs/security-review-checklist.md`](./docs/security-review-checklist.md)
- **Operator console:** [`operator-console/index.html`](./operator-console/index.html)

## Status

**Phase 1 (GCP-only, 2-bidder auction) is built and deployed** to project
`agent-tasker-lcd` (us-central1): the coordinator, the GCP/Gemini direct agent,
and the GCP/Orchestrator (GAEP) agent run on Cloud Run, with the Firestore
ledger, JWKS publishing, and the daily pricing-refresh function live. CI builds
the images and applies Terraform on every push to `main` via Workload Identity
Federation.

The GCP agents' Cloud Run services are locked to coordinator-only
`roles/run.invoker`; the coordinator authenticates with a Google OIDC token in
`X-Serverless-Authorization` (for Cloud Run IAM) plus the per-task RS256 JWT in
`Authorization` (verified by the agent).

Phases 2 (AWS/Nova) and 3 (Azure/GPT) are implemented in-tree — agent code,
Terraform, and CI deploy steps — but not yet deployed: their CI steps are gated
on the `AWS_ROLE_ARN` / `AZURE_CLIENT_ID` secrets, which are unset.

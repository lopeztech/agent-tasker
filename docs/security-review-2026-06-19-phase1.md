# Phase 1 Security Review — Sign-off (2026-06-19)

Records the end-of-v1 review for the **deployed Phase 1 (GCP-only, 2-bidder)**
surface, run against [`docs/security-review-checklist.md`](./security-review-checklist.md).
Scope is the coordinator, the GCP/Gemini and GCP/Orchestrator agents, JWKS
publishing, pricing refresh, and CI. AWS/Nova and Azure/GPT are implemented
in-tree but undeployed; their controls are reviewed at the source level only and
re-reviewed when those stacks go live.

- **Reviewer:** Josh Lopez (operator)
- **Commit under review:** branch `harden/phase1-coordinator-invoker` (the
  coordinator-only invoker change lands here).
- **Method:** Terraform/code is the source of truth (CI applies it on every push
  to `main`), supplemented by the one externally observable artifact (the public
  JWKS document). Items needing live IAM/secret/audit-log export are flagged
  **[live-pending]** — gcloud ADC was expired at review time (`invalid_rapt`);
  capture them post-merge after `gcloud auth login`.

## Headline change reviewed

The GCP agents previously granted `roles/run.invoker` to `allUsers`; the
application JWT was the only auth boundary. This review covers the switch to
**coordinator-SA-only invoker** plus the coordinator's Google OIDC token in
`X-Serverless-Authorization` (Cloud Run IAM) layered over the per-task RS256 JWT
in `Authorization` (agent verification). Two independent gates now protect every
agent call.

## Evidence captured

- Terraform source for all live modules (`infra/coordinator`, `infra/project`,
  `infra/agent-gcp-gemini`, `infra/agent-gcp-orchestrator`).
- JWKS document fetched from
  `https://storage.googleapis.com/agent-tasker-dev-jwks-agent-tasker-lcd/jwks.json`
  — one RS256 signing key, `use: sig`, `kid=fb2366ca-1b5b-47f4-8ce5-7cb2c683c264`.
- CI run on `main` showing node typecheck+test, terraform fmt+validate, and the
  build/push/deploy job all green (run 27448206097).
- Coordinator + agent source for the auth path.

## Findings against checklist

### Coordinator — PASS (source)
- Public `allUsers` invoker is intentional and scoped to the coordinator service
  only (`infra/coordinator/cloud_run.tf`); it is the single-operator SPA/API
  entry point. **[live-pending]** confirm no stray invoker bindings.
- JWKS bucket has object versioning enabled (`infra/coordinator/jwks.tf:35`).
- Callback delivery uses a coordinator-signed RS256 JWT with a stable
  idempotency key; webhook failure does not roll back a completed task
  (`coordinator/src/auction/webhook-delivery.ts`, covered by tests).

### JWT and replay — PASS (source)
- Task token TTL is 60s (`protocol/src/auth.ts:8`, `TOKEN_TTL_SECONDS`).
- Agents verify issuer, audience, and phase before handler logic
  (`agent/src/jwt/verify.ts`); `aud` is agent-specific so tokens can't be
  replayed across agents; tokens are signed per request/phase.
- Webhook tokens use the callback URL as `aud` and carry `event: task.completed`.

### GCP agents — PASS (source), this PR
- Distinct Cloud Run services and distinct runtime service accounts
  (`agent-tasker-dev-gcp-gemini` vs an `…-orch` SA), verified by
  `infra/test/gcp-agent-isolation.test.ts`.
- **Both agents now grant `roles/run.invoker` only to the coordinator runtime
  SA — no `allUsers`** (this PR; static test updated to assert it). Neither agent
  can invoke the other.
- GCP/Gemini has direct Vertex roles only and no GAEP roles; GCP/Orchestrator
  holds the GAEP execution roles and runs via GAEP, not direct Vertex — asserted
  by the isolation and runtime-separation tests.
- Transport gate: coordinator sends a metadata-minted OIDC token (aud = agent
  service URL) in `X-Serverless-Authorization`; Cloud Run validates it and
  forwards `Authorization` (the task JWT) to the container unchanged.

### AWS/Nova and Azure/GPT — source-only (undeployed)
- Nova Bedrock permissions are scoped to Amazon Nova foundation-model ARNs only
  (`infra/agent-aws-nova/iam.tf`), with `InvokeModel`/`InvokeModelWithResponseStream`.
- Full review deferred until Phase 2/3 deploy; re-run this checklist then.

### Secrets and rotation — PARTIAL
- Coordinator private signing key lives in Secret Manager
  (`agent-tasker-dev-coordinator-signing-key`), not committed or in Terraform
  variables. **[live-pending]** secret inventory with owner/rotation/last-rotated
  per secret; Grafana OTLP header sensitivity in TF state.

### Ledger and auditability — PASS (source)
- Bid records carry per-task pricing snapshots; sealed bids are never returned to
  agents. Declines, execute failures, re-auctions, and callback failures are
  distinguishable in the ledger (covered by coordinator tests).
- **[live-pending]** pull one real task's announce→settle audit-log trail and one
  denied request per agent.

### CI and release gates — PASS
- CI runs lint/format/typecheck/tests/build + terraform validate; infra static
  tests still verify GCP agent isolation. New IAM grant carries a justification
  comment in the Terraform.

## Items to capture after merge (require `gcloud auth login`)

1. `gcloud run services get-iam-policy` for both agents → confirm only the
   coordinator SA holds `run.invoker`, and a denied anonymous call returns 403.
2. Coordinator + both agent SA project-IAM exports → least privilege.
3. Secret inventory (owner, rotation interval, last rotation) for the signing key
   and any agent secrets.
4. Audit-log sample: one successful task and one denied request per agent.
5. Post-deploy smoke test: submit a task and confirm it settles end-to-end with
   the new invoker IAM in force (proves the OIDC path works in prod).

## Residual risks (carried forward)

- Both GCP agents share one project; per-project split remains a future tightening
  if IAM Conditions or audit needs become brittle.
- JWKS is served from public GCS directly, not yet behind Cloud CDN / external LB.
- Coordinator public API has no end-user auth layer — single-operator only.
- Callback delivery is signed but does not prove the receiver is operator-owned;
  keep an allowlist before accepting untrusted clients.

## Sign-off

Phase 1 deployed surface passes at the source/Terraform level, with the
coordinator-only invoker change closing the main open finding from the prior
state. Sign-off is **conditional** on capturing the five live-evidence items
above after this PR's CI deploy completes.

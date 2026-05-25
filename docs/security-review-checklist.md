# Security Review Checklist

End-of-v1 audit checklist for issue #85. Use this before promoting a full
four-agent deployment, and repeat after any IAM, JWT, secret, runtime, or
networking change.

## Scope

- Coordinator public API, Firestore ledger, pricing refresh, JWKS publishing,
  and callback delivery.
- GCP/Gemini direct agent and GCP/Orchestrator GAEP agent.
- AWS/Nova and Azure/GPT agent stacks once Phase 2/3 modules are live.
- CI, Terraform state, observability exports, and operator bootstrap paths.

## Evidence To Capture

- Terraform plan output for each live module.
- Cloud IAM / AWS IAM / Azure role assignment export for each runtime identity.
- Current JWKS document, key inventory, and latest rotation timestamp.
- Secret inventory with last rotation date and consumer identity.
- Recent audit-log sample for one successful task and one denied request per
  agent.
- CI run showing lint, format, typecheck, tests, and Terraform validation.

## Coordinator

- [ ] Public access is intentional: `infra/coordinator/cloud_run.tf` grants
  `roles/run.invoker` to `allUsers` only for the coordinator service.
- [ ] Coordinator runtime service account has only ledger/pricing/JWKS/logging
  permissions needed for the deployed code path.
- [ ] Firestore access through `roles/datastore.user` is reviewed against the
  collections the coordinator writes: `tasks`, `pricing`, and rollups.
- [ ] JWKS bucket write permission is bucket-scoped, not project-wide storage
  admin.
- [ ] Callback delivery uses a coordinator-signed RS256 JWT and an
  idempotency key; webhook failure does not roll back or re-auction completed
  tasks.
- [ ] Callback target URLs are stored only in task specs and are not logged with
  sensitive request payloads.
- [ ] No coordinator environment variable contains plaintext long-lived
  secrets except approved telemetry headers during bootstrap.

## JWT And Replay

- [ ] Agent task tokens keep the 60-second TTL from `TOKEN_TTL_SECONDS`.
- [ ] Tokens are signed per request and scoped to one `task_id`, audience, and
  phase.
- [ ] Agents verify issuer, subject, audience, expiration, and phase before
  handler logic runs.
- [ ] Webhook tokens use the callback URL as `aud` and carry `event:
  task.completed`.
- [ ] Replayed bid/execute tokens are rejected after expiration and cannot be
  reused across agents because `aud` is agent-specific.
- [ ] JWKS rotation follows dual-publish: old plus new key, wait at least token
  TTL plus verifier cache TTL, then retire old key.
- [ ] JWKS object versioning is enabled and old versions are retained only for
  the configured bounded window.

## GCP Agents

- [ ] GCP/Gemini and GCP/Orchestrator use distinct Cloud Run services and
  distinct service accounts.
- [ ] Both GCP agent services grant `roles/run.invoker` only to the coordinator
  runtime service account.
- [ ] Neither GCP agent service account can invoke the other agent service.
- [ ] GCP/Gemini has direct Vertex permissions only; it has no GAEP execution
  roles.
- [ ] GCP/Orchestrator has the GAEP execution roles required by its runtime and
  uses GAEP for execution, not direct Vertex execution.
- [ ] Vertex AI access conditions are defense in depth and are not treated as
  the only separation between the two Gemini-backed agents.
- [ ] Agent containers read JWKS from the configured `JWKS_URL` and do not
  accept unsigned local bypasses outside tests.
- [ ] Cloud Run ingress posture is reviewed against the current auth model:
  public DNS plus IAM invoker plus task JWT in Phase 1.

## AWS/Nova

- [ ] Lambda runtime role can assume only from Lambda service principal.
- [ ] Bedrock permissions are limited to Amazon Nova foundation-model ARNs.
- [ ] No non-Nova Bedrock providers are reachable through the runtime role.
- [ ] CloudWatch log permissions are scoped to the agent log group.
- [ ] API Gateway/Lambda authorizer verifies coordinator JWTs before invoking
  bid or execute logic.
- [ ] Secrets Manager entries, if added, grant read access only to the Nova
  runtime role.

## Azure/GPT

- [ ] Managed identity for the agent has only the Azure OpenAI and Key Vault
  permissions required for GPT execution.
- [ ] Key Vault purge protection is enabled and soft delete is configured.
- [ ] Deployer secret permissions are separated from runtime secret
  permissions.
- [ ] Runtime identity can read only approved secret names and cannot set or
  delete secrets.
- [ ] API Management, Function, or Container App edge verifies coordinator JWTs
  before invoking bid or execute logic.
- [ ] Azure OpenAI access cannot reach non-approved deployments or unrelated
  resource groups.

## Secrets And Rotation

- [ ] Coordinator private signing keys are stored in the approved secret store
  and never committed, logged, or embedded in Terraform variables.
- [ ] Each secret has an owner, rotation interval, last rotation timestamp, and
  emergency revoke procedure.
- [ ] Grafana Cloud OTLP headers are treated as sensitive because Terraform
  state can contain them.
- [ ] Terraform state buckets/accounts have versioning, encryption, and access
  limited to operators and CI.
- [ ] Secret rotation is tested in dev before prod: publish new secret, roll
  one service, verify, roll remaining services, revoke old secret.

## Ledger And Auditability

- [ ] Bid records include per-task pricing snapshots and do not expose sealed
  bids to agents.
- [ ] Result records persist GAEP step traces for token, step, and tool-call
  decomposition.
- [ ] Audit logs can reconstruct announce, bid, award, execute, callback, and
  settlement for a task.
- [ ] Declines, execution failures, re-auctions, and callback failures are
  distinguishable in logs and ledger fields.
- [ ] Access to Firestore task documents is limited to coordinator/operator
  identities; agents do not read the ledger directly.

## CI And Release Gates

- [ ] CI passes lint, format, typecheck, tests, build, and Terraform validation.
- [ ] Infra static tests still verify GCP agent isolation.
- [ ] New IAM grants include a short justification in Terraform comments.
- [ ] Every deployable image is built from a reviewed commit and pinned by tag
  or digest in release notes.
- [ ] Rollback path is documented for coordinator and each agent.
- [ ] Security review sign-off records residual risks and follow-up issues.

## Known Residual Risks To Revisit

- Phase 1 keeps both GCP agents in one project; consider a per-project split if
  IAM Conditions or audit requirements become brittle.
- Phase 1 JWKS hosting uses public GCS directly; promote to load balancer plus
  Cloud CDN before cross-cloud verifier traffic matters.
- Coordinator public API has no end-user auth layer yet; add one before moving
  beyond single-operator use.
- Callback delivery signs payload delivery but does not prove the receiver is
  operator-owned; maintain an allowlist before accepting untrusted clients.

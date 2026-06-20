# Phase 2 Security Review — AWS/Nova Sign-off (2026-06-20)

Reviews the now-live AWS/Nova agent against the AWS/Nova section of
[`docs/security-review-checklist.md`](./security-review-checklist.md), following
its instruction to re-run when Phase 2 deploys. Phase 1 (coordinator + GCP
agents) was signed off separately in
[`security-review-2026-06-19-phase1.md`](./security-review-2026-06-19-phase1.md).

- **Reviewer:** Josh Lopez (operator)
- **Surface:** AWS account `794661977072`, us-east-1 — Lambda
  `agent-tasker-dev-aws-nova`, its runtime + CI roles, API Gateway HTTP API, S3
  artifacts bucket, budget.
- **Method:** Terraform/code is the source of truth (CI applies it via the
  OIDC `cicd` role), supplemented by live black-box probes of the public API.
  Items needing an authenticated AWS IAM export are flagged **[live-pending]** —
  the `agent-tasker-dev` SSO token was expired at review time; capture them with
  `aws sso login --profile agent-tasker-dev` when convenient.

## Findings against checklist

### Runtime role least privilege — PASS (source)
From `infra/agent-aws-nova/iam.tf`:
- **Assume policy** trusts only the `lambda.amazonaws.com` service principal —
  no cross-account, no wildcard.
- **Bedrock** grants `bedrock:InvokeModel` + `InvokeModelWithResponseStream`
  scoped to exactly the three Amazon Nova foundation-model ARNs
  (`amazon.nova-micro-v1:*`, `nova-lite-v1:*`, `nova-pro-v1:*`). No other model
  family (Anthropic, Meta, Cohere, …) is reachable — the model-family lock is
  enforced at IAM, not just config.
- **CloudWatch** grants `CreateLogStream` + `PutLogEvents` scoped to the agent's
  own log group ARN only (no `CreateLogGroup`, no wildcard).
- No managed policies attached; no Secrets Manager entries (Nova auth is the
  runtime role itself — there are no long-lived API keys to store).
- **[live-pending]** `aws iam get-role` / `list-role-policies` export to confirm
  the deployed role matches source.

### Auth boundary — PASS (source + live)
- `/bid` and `/execute` are guarded by phase-scoped `requireTaskToken` against
  the coordinator's RS256 JWT (`aud = aws-nova`, JWKS fetched from the
  coordinator and cached 10m); `/health` is intentionally open
  (`agent/aws-nova/src/app.ts`, `server.ts`).
- **Verified live:** `POST /bid` and `POST /execute` return **401** with a
  missing token and with a garbage token; `/health` returns
  `{"ok":true,"agent_id":"aws-nova"}`.
- End-to-end: a real coordinator-signed task settled to `aws-nova` (executed via
  Bedrock), proving the full signed path works.

### CI/CD identity — PASS (source), with residual risk
From `infra/agent-aws-nova/cicd.tf`:
- GitHub OIDC trust is scoped to `aud = sts.amazonaws.com` **and**
  `sub = repo:lopeztech/agent-tasker:ref:refs/heads/main` — PR and fork tokens
  cannot assume the CI role.
- The CI role carries `AdministratorAccess`. Intentional and parallel to the GCP
  CI SA's `roles/owner` for a single-operator project; recorded as residual risk.

### Artifacts bucket — PASS (source)
`infra/agent-aws-nova/artifacts.tf`: S3 bucket has public-access-block (all four
flags), server-side encryption, and versioning enabled.

### Cost guardrail — PASS (source)
`infra/agent-aws-nova/budget.tf`: monthly `aws_budgets_budget` with
percentage-threshold ACTUAL notifications.

## New finding — AWS edge has no network-layer invoker gate

Unlike the GCP agents (locked to coordinator-only `run.invoker`, with the
coordinator presenting an OIDC token in `X-Serverless-Authorization`), the
AWS/Nova API Gateway HTTP API has **no authorizer** — the per-task RS256 JWT
verified inside the Lambda is the *sole* auth boundary. That is acceptable for
the design (the JWT is short-lived, audience-scoped, and phase-scoped), but it is
an asymmetry worth closing as defense-in-depth:

- The endpoint is internet-reachable and will run the Lambda (and incur cost) for
  any request before the JWT check rejects it — an unauthenticated flood is a
  cost/DoS vector that the GCP agents' IAM gate absorbs at the edge.
- **Follow-up options:** API Gateway throttling / usage-plan limits, a Lambda
  authorizer or API Gateway IAM auth (would require the coordinator to SigV4-sign
  or present an IAM-validated token), or AWS WAF in front. Lowest-effort first
  step is API Gateway stage throttling.

## Residual risks / follow-ups

- **AWS edge invoker gate** — JWT-only; add throttling/authorizer/WAF (above).
- **CI role `AdministratorAccess`** — re-scope if the project becomes multi-tenant.
- **[live-pending] IAM export** — confirm deployed runtime role matches source
  after `aws sso login`.
- **AWS Bedrock live pricing parser** (build-order item 9) not yet built; bids use
  `FALLBACK_PRICING` (Nova micro/lite/pro in `/protocol`). Non-blocking.
- **Cross-cloud egress dashboards/alarms** (build-order item 11) — the
  coordinator emits per-request egress events; Grafana panels for the GCP→AWS leg
  are not yet built.

## Sign-off

**The AWS/Nova surface passes** at the source/Terraform level (which CI applies)
with live confirmation of the JWT auth boundary and end-to-end Bedrock execution.
The runtime role enforces the Nova-only model lock at IAM. Sign-off is
**conditional** only on the [live-pending] IAM export; the one net-new finding
(no edge invoker gate) is tracked as a defense-in-depth follow-up, not a blocker
for single-operator use. Re-run the full checklist when Phase 3 (Azure/GPT)
deploys.

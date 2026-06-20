# Phase 3 Security Review — Azure/GPT Sign-off (2026-06-20)

Reviews the now-live Azure/GPT agent against the Azure/GPT section of
[`docs/security-review-checklist.md`](./security-review-checklist.md). Phase 1
(coordinator + GCP) and Phase 2 (AWS/Nova) were signed off in their own dated
records.

- **Reviewer:** Josh Lopez (operator)
- **Surface:** Azure subscription `8db4717d-…` (Pay-As-You-Go), tenant
  `86c1ecd5-…`, region eastus, resource group `agent-tasker-dev-azure` —
  Container App `agent-tasker-dev-azure-gpt`, its user-assigned identity, Key
  Vault `agenttaskerdevazgptkv`, ACR `agenttaskerdevazgptacr`, Azure OpenAI
  `agent-tasker-dev-aoai`, the CI service principal, and the agent Entra app.
- **Method:** Terraform/code is the source of truth (CI applies it); supplemented
  by live `az` queries and black-box probes of the public Container App.

## Interim model note

The GPT-5 family has **zero quota** on this new subscription, so the agent runs
**gpt-4o** (both bid and execute) as an interim. The auction and all controls
below are independent of the model; swap to gpt-5/gpt-5-mini once quota is
granted. See the separate GPT-5 quota-request note.

## Findings against checklist

### Runtime identity least privilege — PASS (live)
- The Container App uses a **user-assigned managed identity**
  (`agent-tasker-dev-azure-gpt-id`) whose **only** role assignment is **AcrPull**
  on the ACR. It holds no Azure OpenAI role and no broad permissions.
- Azure OpenAI is reached with the resource **API key** (not the managed
  identity), so the identity needs no Cognitive Services role. (Trade-off noted
  below — moving to MI auth would let us disable the key entirely.)

### Key Vault — PASS (live)
- **Purge protection enabled**; soft-delete retention 7 days.
- **Deployer vs runtime separation** is clean: the deployer (CI service
  principal `f1b06116-…`) has secret `Get/List/Set/Delete`; the runtime identity
  (`033347f8-…`) has **`Get/List` only** — it cannot set or delete secrets.
- The vault is dedicated to this agent and holds only the OpenAI key secret.
  (Access policies are vault-wide, not per-secret; acceptable given the
  single-secret, single-purpose vault.)

### Container App edge auth — PASS (source + live)
- `/bid` and `/execute` are gated by phase-scoped `requireTaskToken` against the
  coordinator RS256 JWT (`aud = azure-gpt`); `/health` is open.
- **Verified live:** `POST /bid` and `/execute` return **401** without a valid
  token; `/health` returns `{"ok":true,"agent_id":"azure-gpt"}`. End-to-end, the
  4-bidder auction settles tasks to azure-gpt executing via Azure OpenAI.

### Azure OpenAI access scoping — PASS (live), with follow-up
- The agent's API key authorizes only the one `agent-tasker-dev-aoai` resource
  (the sole deployment is `gpt-4o`), in the dedicated resource group. It cannot
  reach other resource groups or unrelated resources.
- `disableLocalAuth` is unset (key auth enabled) and public network access is
  Enabled — see residual risks.

### CI/CD identity — PASS (source), with residual risk
- The CI service principal is scoped to the resource group (**Contributor** on
  `agent-tasker-dev-azure`) plus **AcrPush**, **Storage Blob Data Contributor**
  on the state account, and the KV deployer access policy. OIDC federation is
  scoped to `repo:lopeztech/agent-tasker:ref:refs/heads/main`.
- A subscription-scoped Reader was briefly added while debugging and **removed**;
  the SP is back to RG-scoped. RG Contributor is broad within the RG (parallel to
  the GCP `owner` / AWS `AdministratorAccess` CI identities) — recorded as
  residual risk.

### Secrets and state — PASS, with note
- The OpenAI key is never committed: supplied to Terraform via
  `TF_VAR_azure_openai_api_key` from the `AZURE_OPENAI_API_KEY` GitHub secret,
  stored as a Container App secret + Key Vault secret. Terraform state lives in
  the Azure storage account with **shared-key auth disabled** (AAD-only),
  encrypted at rest. The key and OTLP headers are sensitive values in state —
  state access is limited to the operator and CI SP.

## Residual risks / follow-ups

- **OpenAI key sprawl.** The key exists in 4 places (GitHub secret, Container App
  secret, Key Vault, TF state). **Follow-up:** switch the agent to managed-identity
  auth (grant the UAMI `Cognitive Services OpenAI User` on the OpenAI resource,
  set `disableLocalAuth = true`) to eliminate the key entirely. The Key Vault is
  then unused and can be removed.
- **Public network access** on both the Key Vault and the Azure OpenAI resource.
  The JWT (edge) and key (OpenAI) are the boundaries today; add private endpoints
  / network ACLs before exposing beyond single-operator use.
- **CI SP RG-Contributor** is broad; re-scope if the project becomes multi-tenant.
- **Vestigial agent Entra app.** azure-bootstrap creates an `…-azure-gpt-agent`
  Entra app/SP, but the running agent uses the UAMI + key — the Entra app appears
  unused. Consider removing it.
- **Interim gpt-4o** until GPT-5 quota is granted.

## Sign-off

**The Azure/GPT surface passes** at the source/Terraform level (which CI applies)
with live confirmation of the JWT edge gate, least-privilege runtime identity,
deployer/runtime secret separation, and Key Vault purge protection. The main
hardening opportunity is eliminating the OpenAI API key in favour of
managed-identity auth (tracked above), not a blocker for single-operator use.
Re-review after any move to MI-based OpenAI auth or a network-isolation change.

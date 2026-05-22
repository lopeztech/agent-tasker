# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project status

Greenfield. No code yet. This document is the design spec — a multi-cloud "agent market" where four LLM-backed agents receive a task description, each privately estimates the cost in normalized USD to complete it, submit sealed bids, and the lowest bidder wins and executes the work. Coordinator runs a Vickrey (second-price) auction; agent reputation will layer in once the ledger has ~100 settled tasks.

The four agents are role-locked by design so the market spans both *runtime/capability profiles* and *cross-vendor model families*:

- **GCP / Gemini** — Vertex AI Gemini, direct single-call runtime (low overhead, wins on simple tasks)
- **GCP / Orchestrator** — Gemini Enterprise Agent Platform, multi-step / tool-using orchestrator runtime (higher overhead, wins on complex tasks where decomposition earns its keep)
- **AWS / Nova** — Bedrock-hosted Amazon Nova
- **Azure / GPT** — Azure OpenAI, GPT-5.x class

Two agents live in GCP (same Google model family under the hood, different runtimes, independent endpoints, independent bidders). AWS and Azure host one each. The system is GCP-centric by design — the coordinator lives on GCP, both same-cloud bidders are on Vertex AI/Gemini, and Gemini Enterprise Agent Platform powers the GCP/Orchestrator agent. The "two GCP bidders" thus contrast on **runtime/capability** (direct call vs orchestration); cross-vendor **family contrast** (Google vs Amazon vs OpenAI) sits across the cloud boundary in AWS/Nova and Azure/GPT.

When code starts landing, update this file's commands/architecture sections to reflect what is actually built; keep the design rationale below as the reference for *why*.

## Goals & non-goals

**Goals**
- One public interface that hides the multi-cloud fan-out.
- Four structurally identical agents, role-locked (Gemini direct, Gemini Enterprise Agent Platform orchestrator, Nova, GPT), that compete on **estimated USD cost** for each task.
- Mechanism that pressures agents to bid honestly and rewards accurate estimators over time.
- A market that compares both *runtime/capability profiles* (within Google: direct call vs GAEP orchestrator) and *cross-vendor model families* (Google vs Amazon vs OpenAI) so the data is informative on multiple axes.
- Be cheap at idle. Pay-per-task only.

**Non-goals (initial cut)**
- Not a general agent framework. Tasks are LLM-completable jobs, not arbitrary RPC.
- Not multi-tenant. Single-user/operator at first.
- Not real-time. Batch only — bidding round + execution can take seconds to minutes.

## Delivery phases

The system ships in three phases so that a working auction is in production before the cross-cloud surface area lands. Phase ordering is deliberately GCP-first — depth on Vertex AI and Gemini Enterprise Agent Platform before breadth across clouds.

**Phase 1 — GCP-only (2-bidder auction).** Coordinator + GCP/Gemini + GCP/Orchestrator. The auction is fully functional with two bidders; Vickrey, tier filtering, decline handling, MAPE-based tie-breaking, re-auction on failure all work the same. Cross-cloud egress, AWS auth, Azure auth, and the AWS/Azure pricing parsers are out of scope. The pricing refresh job ships in Phase 1 but only handles GCP Cloud Billing Catalog SKUs (first-party Gemini for the direct agent + Gemini Enterprise Agent Platform consumption SKUs for the orchestrator). Building the GAEP-backed agent is the deepest Phase 1 dependency — the bid estimator must predict not just token usage but step count and tool-call frequency.

**Phase 2 — Add AWS/Nova (3-bidder auction).** First cross-cloud agent. JWT verification on AWS edge, egress accounting, and the AWS Pricing API parser (Bedrock SKUs) all land here. Bringing AWS up alone — rather than alongside Azure — keeps the cross-cloud debugging surface narrow.

**Phase 3 — Add Azure/GPT (4-bidder auction).** Azure API Management / Functions edge, Azure auth, and Azure Retail Prices API parser. Cross-cloud egress dashboards expand. Score-weighted auction layering (after ~100 settled tasks) and analytical-export of the ledger also move into Phase 3 because they're more useful with four agents producing data.

What that means concretely:
- Phase 1's market is informative but narrow — Gemini-direct vs GAEP-orchestrator is a *runtime-vs-runtime* comparison within Google's ecosystem, not a cross-vendor comparison. Useful for surfacing where orchestration pays for itself; not useful for the cross-family economics that Phases 2–3 unlock.
- The same-operator collusion concern is *more* acute in Phase 1 (both bidders share a GCP project; the only competitor is in the same blast radius). Treat the audit log discipline as load-bearing in Phase 1, not as a v2 nicety. Both GCP agents live in one project (`agent-tasker`) with separate service accounts, publisher-scoped IAM Conditions on `aiplatform.user`, and Cloud Run services locked to coordinator-only invocation. Per-project split is a future option if compliance demands it or IAM Conditions prove brittle, not a Phase 1 requirement.
- The bid round in Phase 1 has fewer moving parts — no cross-cloud RTT — so end-to-end latency drops by ~100–200ms vs the steady-state Phase 3 profile.
- Phase 2 is the moment cross-cloud egress, signed-URL attachment patterns, and per-cloud JWKS-cache behavior get exercised. Easier to debug with one cross-cloud peer than two.

## High-level architecture

```
                  ┌──────────────────────────┐
   client ──▶     │   Coordinator (GCP)      │   ◀── single public endpoint (async)
                  │   - task intake          │       POST /tasks → {task_id}
                  │   - auction logic        │       GET  /tasks/:id → status/result
                  │   - results + scoring    │       (optional webhook on completion)
                  │   - JWKS publisher       │
                  └─┬──────┬──────┬──────┬───┘
                    │      │      │      │   (parallel bid request, JWT-authed)
              ┌─────▼─┐ ┌──▼──┐ ┌─▼───┐ ┌▼──────┐
              │ GCP   │ │ GCP │ │ AWS │ │ Azure │
              │Gemini │ │Orch │ │Nova │ │  GPT  │
              │Vertex │ │GAEP │ │Bedrk│ │AzOAI  │
              └───┬───┘ └──┬──┘ └──┬──┘ └───┬───┘
                  └────────┴───────┴────────┘
                            │ reads daily pricing snapshot
                            ▼
                    Firestore: pricing collection
                    (refreshed daily by Cloud Function)
```

**Coordinator** runs on GCP — two of the four agents already live there, removing some egress and IAM complexity. It owns:
- Task intake API (async: `POST /tasks`, `GET /tasks/:id`, optional webhook callback)
- Auction protocol state machine
- Firestore ledger of bids, awards, results, accuracy scores, per-task pricing snapshots
- JWKS endpoint (static GCS bucket fronted by Cloud CDN / external HTTPS LB) so each agent can verify coordinator-signed JWTs
- Daily pricing refresh job (Cloud Scheduler → Cloud Function)

**Each agent** exposes the same internal contract — `/bid`, `/execute`, `/health` — but is implemented natively on its cloud and locked to a specific runtime (and, where applicable, model family):
- GCP / Gemini: Cloud Run → Vertex AI (first-party Gemini, direct single-call runtime)
- GCP / Orchestrator: Cloud Run → Gemini Enterprise Agent Platform (multi-step orchestration over Gemini + tools)
- AWS / Nova: API Gateway → Lambda → Bedrock (Amazon Nova)
- Azure / GPT: API Management → Functions / Container Apps → Azure OpenAI (GPT-5.x)

The two GCP agents share one project (`agent-tasker`) but **must be deployed as fully independent stacks** — separate Cloud Run services, separate service accounts, distinct runtime stacks (direct Vertex SDK vs GAEP), coordinator-only Cloud Run invokers. They are competitors, not siblings; sharing a service account or making the Cloud Run services mutually invokable would let them see each other's bids and break the sealed-bid property. Note: because both agents target Google models (Gemini), publisher-path IAM Conditions alone don't distinguish them — the runtime layer (direct SDK vs GAEP) plus distinct service accounts plus Cloud Run invoker scoping are what enforce isolation. Per-project split is available as a future tightening if needed but is not the Phase 1 baseline.

Agents are reachable only by the Coordinator (signed JWT, see auth section). No agent talks to another agent.

## Client-facing API

Async. Tasks complete in seconds to minutes; sync HTTP is a bad fit.

```
POST /tasks
  body: { prompt, attachments?, min_tier?, callback_url?, deadline? }
  → 202 { task_id, status_url }

GET /tasks/:task_id
  → { status: "bidding" | "awarded" | "executing" | "completed" | "failed",
      output?, usage?, winner?, bids? }
```

If `callback_url` is provided, the coordinator POSTs the final result to it on completion (signed with the same key that mints agent JWTs). Polling is the source of truth; webhook is an optional convenience.

## The bidding protocol

A task lifecycle has four phases. Keep them as distinct API calls so the auction is auditable.

1. **Announce** — Coordinator broadcasts `task_id + task_spec` to all four agents in parallel, each with a per-task signed JWT (60s TTL, audience = agent ID, `phase` claim = `bid`).
2. **Bid** — Each agent returns one of:
   - `{task_id, agent_id, tier, est_input_tokens, est_output_tokens, model_family, price_in_usd_per_mtoken, price_out_usd_per_mtoken, bid_usd, expires_at, signature}`
   - `{task_id, agent_id, status: "no_bid", reason: "context_overflow" | "policy" | "capability" | "internal_error"}`

   Bids are sealed: agents do not see each other. The exact `model_id` is logged in the audit trail but not part of winner selection — only `tier` is exposed to the auction.
3. **Award** — Coordinator picks a winner per Vickrey rules, sends `award` to the winner and `reject` to the others. Signed receipts both ways.
4. **Execute & settle** — Winner runs the task, returns the output plus *actual* token usage. Coordinator records actual vs bid against the per-task pricing snapshot, updates the agent's accuracy score, stores everything in the ledger.

### Bid timeout — adaptive

Wait 2 seconds after announce. If at least 2 agents have bid, extend the window by 1s for late arrivals. Repeat the 1s extension while at least one bid landed in the previous window, capped at 5s total wall clock. Run the auction with whoever's in. Non-responders are dropped from this round; persistent non-response affects health metrics, not bid accuracy.

### What is being bid (USD)

Token counts alone aren't comparable across the three model families in play — Gemini, Nova, and GPT all tokenize differently, and per-token prices differ by ~10× across the cheapest and dearest. Layered on top, the orchestrator's multi-step runtime spends tokens across multiple LLM calls plus per-tool-invocation overhead, so its bid arithmetic adds step count × per-step token estimate (and GAEP platform fees where applicable). The bid reduces to a single normalized USD scalar:

> `bid_usd = (est_input_tokens / 1e6) * price_in_usd + (est_output_tokens / 1e6) * price_out_usd`

Agents read prices from the coordinator-published Firestore pricing collection (see Pricing data) so all four agents see the same prices for any model on any given day. The exact prices used are snapshotted into the ledger at bid time, so accuracy can be evaluated retroactively even after the collection updates.

USD bidding lets Nova (cheap, may use more tokens) genuinely compete against GPT-5 (dearer, may need fewer), and lets the direct Gemini agent undercut the orchestrator on simple tasks while losing to it on complex multi-step jobs where decomposition saves total tokens. This is the mechanic that makes the market interesting.

### Bid sampling — stochastic

Bids are produced by a small LLM call. Sampling parameters are at each agent's discretion (temperature, top-p, etc.) — no determinism requirement. The same task can yield slightly different bids from the same agent across runs. **Consequence:** the eval harness measures MAPE by averaging multiple runs of each fixture task to get a stable accuracy signal. Single-shot accuracy numbers are misleading.

### Auction rule — Vickrey (second-price)

Lowest bid wins. The price recorded for the winner is the **second-lowest** bid. Agents below the optional `min_tier` filter are excluded before scoring.

Vickrey is incentive-compatible: each agent's dominant strategy is to bid its true estimate — shading down risks winning at a loss; shading up just loses business without changing the price. After ~100 settled tasks, layer in a score-weighted variant where bids are multiplied by an agent's historical bid-accuracy multiplier; until then, plain Vickrey.

### Quality floor — tiered with optional minimum

Every bid declares a `tier`: `small | medium | frontier`. Tier-to-model mapping lives in `/protocol`:

- `small` — bid-class models (Gemini Flash, Nova Micro, GPT-5 mini)
- `medium` — mid-class models in each family
- `frontier` — top of each family (Gemini 2.5 Pro, Nova Pro, GPT-5). The GCP / Orchestrator agent declares `frontier` since its underlying execution model is Gemini 2.5 Pro, even though its competitive advantage is in the runtime layer, not raw model quality.

Tasks may include `min_tier` in the spec. Agents below it are excluded from the auction *before* winner selection. Default is no floor — the market does its job.

### Tie-breaking — historical accuracy

If two or more bids tie on `bid_usd`, break by lowest historical MAPE. Until an agent has settled at least 10 tasks (cold start), fall through to random selection among the tied cold-start agents.

### Decline-to-bid

Any agent may return `no_bid` with a reason code instead of a bid. Reason codes (`context_overflow`, `policy`, `capability`, `internal_error`) are logged separately from real bids and don't affect MAPE. If all four decline, return error to the client with the union of reasons.

### Execution overrun — winner eats it

If the winner's actual token usage exceeds the bid, the recorded price stays at the auctioned price; the agent's MAPE takes the hit. Operational safety: hard kill at **10× the bid** in tokens. If that ever fires it's a bug, not normal flow.

### Mid-execution failure — re-auction

If the winner fails during `/execute`, exclude them and re-auction with the remaining 3 agents. If a second failure occurs in the re-auction, exclude that agent too and run with the remaining 2. If ≤1 agents remain, return error to client. Each fallback step gets its own ledger entry so per-agent failure rates are visible.

### Truthfulness enforcement (ledger-driven)

Per-agent ledger tracks:
- Mean absolute percentage error (MAPE) on bids
- Sign of error (chronic under- vs over-bidder)
- Win rate vs bid rate
- Decline rate by reason code

Used for: (a) tie-breaking (today), (b) score-weighted auction (after ~100 tasks), (c) detecting model drift or accidental cross-contamination between the two GCP agents.

## Per-cloud agent implementation

All four agents implement the same shape, written in TypeScript on Node 22:

```
POST /bid       { task }  → { bid | no_bid }
POST /execute   { task }  → { output, actual_usage }
GET  /health
```

Internally, `/bid` is itself a small LLM call: a cheap fast model (Gemini Flash, Nova Micro, GPT-5 mini) reads the task and outputs a structured JSON estimate. The orchestrator's bid is more involved — it must estimate step count and tool-call frequency, not just a single LLM call's tokens. `/execute` routes to the agent's pinned production runtime.

| | GCP / Gemini | GCP / Orchestrator | AWS / Nova | Azure / GPT |
|-|-|-|-|-|
| Edge | Cloud Run (built-in HTTPS) | Cloud Run (built-in HTTPS) — entrypoint into GAEP | API Gateway HTTP API | API Management or Function URL |
| Compute | Cloud Run (min-instances=0) | Cloud Run (thin shim) + Gemini Enterprise Agent Platform (managed runtime) | Lambda Node 22 (512MB) | Functions Flex / Container Apps |
| LLM (bid) | Vertex AI — Gemini Flash | Vertex AI — Gemini Flash (step/tool estimator) | Bedrock — Nova Micro/Lite | Azure OpenAI — GPT-5 mini |
| LLM (execute) | Vertex AI — Gemini 2.5 Pro (single call) | GAEP composite over Gemini 2.5 Pro + registered tools (multi-step) | Bedrock — Nova Pro | Azure OpenAI — GPT-5 |
| Role lock | Direct Vertex SDK only — orchestration disallowed by deployment shape (no agent-builder roles on SA) | GAEP runtime only — direct Vertex calls disallowed in handler (the value prop is multi-step; cheating to a single call defeats the comparison) | Amazon only (IAM) | OpenAI only |
| Secrets | Secret Manager (per-SA access) | Secret Manager (per-SA access) | Secrets Manager | Key Vault |
| Auth from coordinator | JWT (RS256) | JWT (RS256) | JWT (RS256) | JWT (RS256) |
| Logs | Cloud Logging (filtered by SA) | Cloud Logging (filtered by SA) | CloudWatch | App Insights |

The two GCP agents share one project (`agent-tasker`) but each gets its **own service account** and its **own runtime**. The Gemini agent's SA holds `roles/aiplatform.user` (with an IAM Condition restricting to `publishers/google/` if you want belt-and-suspenders); the Orchestrator agent's SA holds both `roles/aiplatform.user` and the GAEP-specific roles required for agent/tool execution. Each agent's Cloud Run service is deployed with `--ingress=internal-and-cloud-load-balancing` (or stricter) and `roles/run.invoker` granted only to the coordinator's service account — neither agent can invoke the other. Because both agents call Google models, publisher-path IAM Conditions cannot distinguish them on their own; the runtime separation (direct SDK vs GAEP) plus distinct SAs plus Cloud Run invoker scoping are the load-bearing isolation.

**Role lock strictness:** runtime + role allowlist, pinned per deployment. Gemini agent gets only the SDK roles needed for `predict`; Orchestrator gets the GAEP agent-execution roles. Audit log captures the exact `model_id` and (for the orchestrator) the step trace. Upgrades (Gemini 2.5 Pro → 3.0 Pro on either agent, or GAEP version pins on the orchestrator) are a config + redeploy, not an IAM change.

## Coordinator → agent auth (signed JWT)

Single mechanism across all four agents. RS256 keypair held by the coordinator (private key in Secret Manager). Public key published as a JWKS document on a static GCS bucket fronted by Cloud CDN / external HTTPS load balancer.

Per-task tokens:
- 60-second TTL
- `aud` = target agent ID
- `sub` = coordinator service identity
- Custom claims: `task_id`, `phase` (`bid` | `award` | `execute` | `reject`)
- Signed per request — no token reuse across phases

Each agent verifies tokens at the entrypoint (Cloud Run middleware / Lambda authorizer / Function middleware) by fetching JWKS once and caching for the rotation window. Key rotation: dual-publish in JWKS for the rotation window, switch active signing key, retire old after agents have refreshed.

## Pricing data (scheduled refresh)

Bids are denominated in USD, so per-token prices for every model in scope must be available to the bid handlers. Daily Cloud Scheduler trigger → Cloud Function fetches and writes:

- **Source:** GCP Cloud Billing Catalog (Vertex AI Gemini SKUs + Gemini Enterprise Agent Platform consumption SKUs) in Phase 1; AWS Pricing API (Bedrock) added in Phase 2; Azure Retail Prices API added in Phase 3. For models or platform SKUs not exposed cleanly in those APIs (GAEP per-step / per-tool-invocation pricing is the most likely gap), fall back to maintained constants in `/protocol`.
- **Destination:** Firestore `pricing` collection keyed by `model_id`, with `effective_date`, `price_in_usd_per_mtoken`, `price_out_usd_per_mtoken`.
- **Failure mode:** last-known-good. If a vendor fetch fails, agents continue using the previous day's prices. Job failure pages on-call (eventually); bids never block.
- **Per-task snapshot:** when a bid is recorded, the prices used are written into the bid record itself. Eval replays remain reproducible even after the collection updates.
- **Quarterly review:** parsing logic is the brittle bit — vendor pages and APIs drift silently. Calendar reminder to verify the parsers still work.

## Storage (Firestore)

Firestore in Native mode. Two collections:
- `tasks/{task_id}` — root document holds task spec, status, and final result. Sub-records (per-phase, per-agent) live in subcollections: `tasks/{task_id}/bids/{agent_id}`, `tasks/{task_id}/awards/{n}`, `tasks/{task_id}/results/{agent_id}`. Each subcollection doc carries `phase`, `agent_id`, `timestamp` for replay ordering.
- `pricing/{model_id}/snapshots/{effective_date}` — daily price snapshots, immutable; agents read the latest snapshot at bid time and the coordinator copies the per-task subset into the bid record.

Composite indexes: `(agent_id, timestamp)` on a `bids` collection-group for per-agent rolling stats; `(agent_id, phase, timestamp)` for separate rate cuts.

Firestore scales to zero at idle and bills per document read/write — comparable to DynamoDB on-demand for this workload. Analytical export to BigQuery is deferred to Phase 3, when ledger volume justifies it.

## Observability (Grafana Cloud)

OpenTelemetry SDK in the TypeScript code, auto-instrument Cloud Run / Lambda / Functions handlers, ship to Grafana Cloud's OTLP endpoint. Free tier (50GB logs, 50GB traces, 10k metrics) covers up to ~100k tasks/mo; 14-day retention is the main constraint.

Single trace per task spans the coordinator and all four agents. Span attributes: `task_id`, `agent_id`, `phase`, `tier`, `bid_usd`, `actual_usd`, `mape`. Dashboards: per-agent win rate, MAPE distribution, decline rate by reason, bid-round latency p50/p95/p99.

## IaC (Terraform)

One root module per agent and one for the coordinator:

```
/infra/coordinator       # GCP — Cloud Run, Firestore, GCS+Cloud CDN for JWKS, Cloud Scheduler+Function for pricing
/agent/gcp-gemini/infra  # GCP — own Cloud Run service + SA, IAM Condition on publishers/google
/agent/gcp-orchestrator/infra  # GCP — own Cloud Run service + SA + GAEP roles, Gemini Enterprise Agent Platform runtime
/agent/aws-nova/infra    # AWS — API Gateway + Lambda + Bedrock
/agent/azure-gpt/infra   # Azure — APIM/Functions + Key Vault + Azure OpenAI
```

State on GCS with object versioning + Firestore-based locking (or a single Cloud Storage bucket per env with `terraform` native state locking). Three provider blocks (`google`, `aws`, `azurerm`). The two GCP agents are **not** parameterized into one stack — separation is the whole point.

## Cost model

Numbers are order-of-magnitude as of late 2025/early 2026 list pricing — recheck before committing.

**Per-task variable cost**

- Bidding: 4 small-model calls × ~500 in / ~100 out tokens ≈ **$0.0004** total. Gemini Flash and Nova Micro are near-free; GPT-5 mini sets the bid-phase floor. The orchestrator's bid call is the same shape (single Gemini Flash invocation predicting step/tool cost), not an actual multi-step run.
- Execution: only the winner runs. Typical "medium-simple" task (4k in, 1k out, single call): Nova Pro ~**$0.005**, Gemini 2.5 Pro direct ~**$0.02**, GPT-5 ~**$0.04**. Typical "medium-complex" multi-step task (same prompt, but 3–5 tool-using steps): GAEP orchestrator ~**$0.08–0.20** depending on tool/platform fees — but it can complete tasks the single-call agents would have to decline or fail partway. Expect Nova and Gemini-direct to win frequently on simple tasks; the orchestrator to win selectively on tasks where decomposition genuinely pays.
- Infra round-trip: Cloud Run + Firestore + logs ≈ **$0.00002**. Negligible.

**Cross-cloud egress.** Coordinator on GCP; both GCP agents (Gemini direct, GAEP orchestrator) get intra-GCP bid traffic (free within the project). AWS and Azure legs cross cloud boundaries — GCP egress is ~$0.12/GB to internet, so a task shipping 100KB to both off-cloud agents costs fractions of a cent; ~$180/mo at 1M tasks/mo with 1MB payloads. If attachments grow, switch to a shared GCS bucket the other clouds read via signed URLs, or send only a content hash and let agents pull. Phase 1 has zero cross-cloud egress; Phase 2 adds the AWS leg; Phase 3 adds the Azure leg.

**Monthly fixed-ish costs**

| Item | Est. monthly |
|-|-|
| 3× cloud accounts at idle (logs, KMS, secrets — GCP counts once even with 2 agents in one project) | $5–15 |
| Coordinator (Cloud Run + Firestore + JWKS via GCS+Cloud CDN) | $5–25 |
| Extra GCP infra for the second agent (additional Cloud Run service + SA, shared project) | $1–5 |
| Pricing refresh Cloud Function (1 invocation/day) | <$1 |
| Domain + cert | ~$1 |
| Observability — Grafana Cloud free tier | $0 |
| **Floor** | **~$15–50** |

**At 1k tasks/month (hobby):** ~$25 infra + ~$20 LLM (Nova/Gemini-heavy mix) = **~$45/mo**.
**At 100k tasks/month:** ~$80 infra + ~$1,500–3,500 LLM depending on win distribution = **~$1.6k–3.6k/mo**.
**At 1M tasks/month:** infra still <$600; LLM spend $15k–35k depending on which model dominates wins.

The headline: **infrastructure is rounding error vs. model tokens at any non-trivial volume.** Optimization energy belongs on bid accuracy and winning-model cost, not on Cloud Run vs Lambda.

## Operational notes

The major design questions are settled (see sections above). What remains is operational hygiene that matters in steady state:

1. **Tokenizer differences are real.** Gemini, Nova, and GPT all tokenize differently. The bid model needs prompt examples calibrated to *its* tokenizer's behavior — don't share bid prompts verbatim across agents without checking. Note: both GCP agents share the Gemini tokenizer, so bid noise between them is dominated by runtime-cost-prediction error (step count, tool calls), not tokenization differences.
2. **Same-operator collusion risk.** Two agents share a GCP project. The technical isolation rests on (a) distinct service accounts, (b) IAM Conditions restricting each SA to one Vertex AI publisher path, and (c) Cloud Run invoker IAM granting only the coordinator's SA — so neither agent can invoke the other or call the wrong model family. The coordinator's audit log should still treat them as fully independent participants and watch for correlated bidding patterns (both always under-bidding by similar amounts) as a smell of accidental cross-contamination — shared bid prompts or shared base images can leak signal even with SA-level isolation. Per-project split is a future tightening, not a Phase 1 requirement.
3. **Latency shape.** Adaptive bid timeout caps at 5s. Cross-cloud AWS/Azure legs add ~100–200ms over the GCP-local agents. Acceptable for batch.
4. **Stochastic-bid noise.** With non-deterministic bid sampling, MAPE measurement requires averaging multiple runs of fixture tasks. Single-shot accuracy numbers are misleading.
5. **Model and runtime upgrades.** Pinned-per-deployment lock means upgrading Gemini 2.5 Pro → 3.0 Pro on either GCP agent, or pinning a new GAEP runtime version on the orchestrator, is a config + Terraform apply. Do this for one agent at a time and watch MAPE / win rate for ~24h before moving on. GAEP runtime upgrades especially can shift step-count behavior — re-baseline the orchestrator's bid model after any runtime change.
6. **Pricing parser drift.** The daily refresh job parses vendor pricing pages/APIs. These break silently — quarterly review is mandatory or you're bidding against stale prices.
7. **JWKS rotation.** Dual-publish active and incoming public keys for the rotation window (≥ token TTL × cache TTL on agents) before retiring the old one. Skipping this breaks every in-flight task.
8. **Eval harness early.** Build `/eval` before agent #2 lands. A directory of representative tasks with expected USD ranges lets you measure each agent's bid accuracy in CI before exposing the system to live traffic.
9. **GAEP operational quirks.** Gemini Enterprise Agent Platform's per-step / per-tool consumption pricing is the brittle bit for the orchestrator's bid accuracy — re-baseline the bid model whenever GAEP changes its consumption SKUs, runtime version, or tool-billing model. Step traces should be persisted in the ledger (not just final token counts) so MAPE can be decomposed into "wrong about token usage" vs "wrong about step count" vs "wrong about tool calls."

## Repo layout

```
/coordinator        # GCP-hosted, owns the auction
/agent              # shared agent code (bid/execute logic, prompt templates)
/agent/gcp-gemini   # Cloud Run handler + Terraform, Vertex AI first-party Gemini
/agent/gcp-orchestrator  # Cloud Run shim + Terraform, Gemini Enterprise Agent Platform runtime
/agent/aws-nova     # Lambda handler + Terraform, Bedrock Amazon
/agent/azure-gpt    # Function/Container handler + Terraform, Azure OpenAI
/protocol           # Zod schemas for bid/execute/award/result + tier mapping + pricing fallback constants
/infra              # cross-cloud Terraform root, JWKS publication, pricing refresh Cloud Function
/eval               # task fixtures + scoring harness (MAPE-aware: averages over runs)
```

The two GCP agents share `/agent` core but have separate deploy roots (separate Cloud Run services and service accounts in the shared `agent-tasker` project). Do **not** factor them into a single parameterized stack — the parameter ("which model?") is the entire point of their independence.

## Build order

### Phase 1 — GCP-only (2-bidder auction)

1. **Protocol first.** Zod schemas in `/protocol` for bid / execute / award / result / no_bid. Tier mapping. Pricing constants fallback. Everything downstream depends on these.
2. **Coordinator skeleton.** Async API (`POST /tasks`, `GET /tasks/:id`) on Cloud Run, Firestore ledger, JWT signing + JWKS endpoint (GCS + Cloud CDN), basic auction state machine. Run with no agents — exercise the flow.
3. **First agent end-to-end: GCP / Gemini.** Cloud Run service in the `agent-tasker` project with its own service account (publisher-scoped IAM Condition), Vertex AI first-party Gemini, **direct single-call runtime only**. JWT verification at entry; Cloud Run ingress locked to coordinator-only invocation. Bid → execute → settle round-trip with the coordinator. Deliberately *not* GAEP — this agent is the cheap, simple-task specialist.
4. **Pricing refresh Cloud Function — GCP only.** Daily Cloud Scheduler → Cloud Function populating the Firestore pricing collection from the GCP Cloud Billing Catalog (Vertex AI Gemini SKUs + Gemini Enterprise Agent Platform consumption SKUs), with last-known-good fallback. Maintained constants in `/protocol` cover any GAEP SKUs not exposed cleanly in the Billing Catalog. Agent reads from it for bid USD calculation. AWS and Azure parsers come in later phases.
5. **Second GCP agent: Orchestrator (Gemini Enterprise Agent Platform).** Second Cloud Run shim in the same project with its own service account and GAEP agent-execution roles. Define the orchestrator's tool surface (start small — read-only HTTP fetch, a search/retrieval tool, and a code-evaluation sandbox if needed). First time the auction has real competition; smoke-tests the SA + runtime-separation isolation between the two GCP agents. The bid estimator here is the hardest single piece of Phase 1 — it must predict step count and tool-call frequency to land bids within MAPE budget.
6. **Vickrey, tiers, decline, tie-break, re-auction.** All the auction rules now have a real testbed with two real bidders.
7. **Ledger + accuracy scoring.** MAPE rollups, decline-rate dashboards, win-rate by tier (per-agent, even with just two).
8. **Eval harness + Grafana dashboards (Phase 1 cut).** Coordinator + both GCP agents instrumented; eval fixtures answering "is Gemini-direct vs GAEP-orchestrator working as a market — do simple tasks reliably go to direct and complex multi-step tasks reliably go to the orchestrator?"

End of Phase 1: a production-ready 2-bidder auction running entirely on GCP. Real product, just narrower than the long-term vision.

### Phase 2 — Add AWS / Nova (3-bidder auction)

9. **Pricing refresh extension — AWS Bedrock.** Add the AWS Pricing API parser (Bedrock SKUs) to the existing daily Cloud Function.
10. **AWS / Nova agent.** API Gateway + Lambda + Bedrock with the Nova-only IAM role. JWT verification at the Lambda authorizer. First cross-cloud agent — debug egress, JWKS cache behavior, signed-URL attachment patterns in isolation before Azure lands.
11. **Cross-cloud egress dashboards + cost alarms.** GCP→AWS leg is the first thing that costs real money on the network path.
12. **Eval harness expansion.** Re-baseline MAPE per agent across the three-way market.

End of Phase 2: cross-cloud surface area proven against one peer cloud.

### Phase 3 — Add Azure / GPT (4-bidder auction)

13. **Pricing refresh extension — Azure Retail Prices.** Add the Azure Retail Prices API parser to the daily Cloud Function.
14. **Azure / GPT agent.** APIM / Functions + Azure OpenAI with the OpenAI-only access. JWT verification at the Functions middleware.
15. **Cross-cloud egress dashboards expand.** GCP→Azure leg added; alarms cover both off-cloud legs.
16. **Eval harness expansion.** Re-baseline MAPE across the four-way market.
17. **Score-weighted auction layer.** Once ~100 settled tasks of ledger data exist (mostly post-Phase-3), multiply bids by historical accuracy multipliers and observe behavior shift.
18. **BigQuery export (optional).** If ledger volume justifies it, export Firestore → BigQuery for analytical queries on bid distributions and model-family economics over time.

Phase 1 is buildable in two to three weeks by one person. Phases 2 and 3 add roughly one to two weeks each for the cross-cloud agent and its pricing parser.

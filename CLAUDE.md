# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Greenfield. No code yet. This document is the design spec — a multi-cloud "agent market" where four LLM-backed agents receive a task description, each privately estimates the cost in normalized USD to complete it, submit sealed bids, and the lowest bidder wins and executes the work. Coordinator runs a Vickrey (second-price) auction; agent reputation will layer in once the ledger has ~100 settled tasks.

The four agents are model-locked by design so the market spans the major frontier families:

- **AWS / Claude** — Bedrock-hosted Anthropic Claude
- **AWS / Nova** — Bedrock-hosted Amazon Nova
- **Azure / GPT** — Azure OpenAI, GPT-5.x class
- **GCP / Gemini** — Vertex AI Gemini

Two agents live in AWS (different models, independent endpoints, independent bidders). Azure and GCP host one each.

When code starts landing, update this file's commands/architecture sections to reflect what is actually built; keep the design rationale below as the reference for *why*.

## Goals & non-goals

**Goals**
- One public interface that hides the multi-cloud fan-out.
- Four structurally identical agents, model-locked (Claude, Nova, GPT, Gemini), that compete on **estimated USD cost** for each task.
- Mechanism that pressures agents to bid honestly and rewards accurate estimators over time.
- Coverage of all four major frontier model families so the market is informative, not just decorative.
- Be cheap at idle. Pay-per-task only.

**Non-goals (initial cut)**
- Not a general agent framework. Tasks are LLM-completable jobs, not arbitrary RPC.
- Not multi-tenant. Single-user/operator at first.
- Not real-time. Batch only — bidding round + execution can take seconds to minutes.

## Delivery phases

The system ships in two phases so that a working auction is in production before the cross-cloud surface area lands.

**Phase 1 — AWS-only (2-bidder auction).** Coordinator + AWS/Claude + AWS/Nova. The auction is fully functional with two bidders; Vickrey, tier filtering, decline handling, MAPE-based tie-breaking, re-auction on failure all work the same. Cross-cloud egress, Azure auth, GCP auth, and the Azure/GCP pricing parsers are out of scope. The pricing refresh job ships in Phase 1 but only handles AWS Bedrock prices.

**Phase 2 — Add Azure/GPT and GCP/Gemini (4-bidder auction).** Both new agents come up at the same time (the engineering work happens in parallel; bring them online one at a time so JWT verification and egress can be debugged in isolation). The pricing refresh job extends to cover Azure Retail Prices API and GCP Cloud Billing Catalog. Cross-cloud egress dashboards land here. Score-weighted auction layering (after ~100 settled tasks) and S3 ledger export also move into Phase 2 because they're more useful with four agents producing data.

What that means concretely:
- Phase 1's market is informative but narrow — Nova vs Claude is a *frontier-vs-cost* comparison, not a four-way frontier comparison.
- The same-operator collusion concern is *more* acute in Phase 1 (both bidders share an AWS account; the only competitor is in the same blast radius). Treat the audit log discipline as load-bearing in Phase 1, not as a v2 nicety.
- The bid round in Phase 1 has fewer moving parts — no cross-cloud RTT — so end-to-end latency drops by ~100–200ms vs Phase 2's profile.

## High-level architecture

```
                  ┌──────────────────────────┐
   client ──▶     │   Coordinator (AWS)      │   ◀── single public endpoint (async)
                  │   - task intake          │       POST /tasks → {task_id}
                  │   - auction logic        │       GET  /tasks/:id → status/result
                  │   - results + scoring    │       (optional webhook on completion)
                  │   - JWKS publisher       │
                  └─┬──────┬──────┬──────┬───┘
                    │      │      │      │   (parallel bid request, JWT-authed)
              ┌─────▼─┐ ┌──▼──┐ ┌─▼───┐ ┌▼──────┐
              │ AWS   │ │AWS  │ │Azure│ │ GCP   │
              │Claude │ │Nova │ │ GPT │ │Gemini │
              │Bedrock│ │Bedrk│ │AzOAI│ │Vertex │
              └───┬───┘ └──┬──┘ └──┬──┘ └───┬───┘
                  └────────┴───────┴────────┘
                            │ reads daily pricing snapshot
                            ▼
                    DynamoDB: pricing table
                    (refreshed daily by Lambda)
```

**Coordinator** runs on AWS — two of the four agents already live there, removing some egress and IAM complexity. It owns:
- Task intake API (async: `POST /tasks`, `GET /tasks/:id`, optional webhook callback)
- Auction protocol state machine
- DynamoDB ledger of bids, awards, results, accuracy scores, per-task pricing snapshots
- JWKS endpoint (static S3 + CloudFront) so each agent can verify coordinator-signed JWTs
- Daily pricing refresh Lambda

**Each agent** exposes the same internal contract — `/bid`, `/execute`, `/health` — but is implemented natively on its cloud and locked to a specific model family:
- AWS / Claude: API Gateway → Lambda → Bedrock (Anthropic Claude)
- AWS / Nova: API Gateway → Lambda → Bedrock (Amazon Nova)
- Azure / GPT: API Management → Functions / Container Apps → Azure OpenAI (GPT-5.x)
- GCP / Gemini: Cloud Run → Vertex AI (Gemini)

The two AWS agents share an account but **must be deployed as fully independent stacks** — separate API Gateways, separate Lambdas, separate IAM roles, separate Bedrock model permissions. They are competitors, not siblings; co-locating them would let them see each other's bids and break the sealed-bid property.

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

Token counts alone aren't comparable across the four model families — Claude, Nova, GPT, and Gemini all tokenize differently, and per-token prices differ by ~10× across the cheapest and dearest. The bid reduces to a single normalized USD scalar:

> `bid_usd = (est_input_tokens / 1e6) * price_in_usd + (est_output_tokens / 1e6) * price_out_usd`

Agents read prices from the coordinator-published DynamoDB pricing table (see Pricing data) so all four agents see the same prices for any model on any given day. The exact prices used are snapshotted into the ledger at bid time, so accuracy can be evaluated retroactively even after the table updates.

USD bidding lets Nova (cheap, may use more tokens) genuinely compete against Claude or GPT-5 (dearer, may need fewer). This is the mechanic that makes the market interesting.

### Bid sampling — stochastic

Bids are produced by a small LLM call. Sampling parameters are at each agent's discretion (temperature, top-p, etc.) — no determinism requirement. The same task can yield slightly different bids from the same agent across runs. **Consequence:** the eval harness measures MAPE by averaging multiple runs of each fixture task to get a stable accuracy signal. Single-shot accuracy numbers are misleading.

### Auction rule — Vickrey (second-price)

Lowest bid wins. The price recorded for the winner is the **second-lowest** bid. Agents below the optional `min_tier` filter are excluded before scoring.

Vickrey is incentive-compatible: each agent's dominant strategy is to bid its true estimate — shading down risks winning at a loss; shading up just loses business without changing the price. After ~100 settled tasks, layer in a score-weighted variant where bids are multiplied by an agent's historical bid-accuracy multiplier; until then, plain Vickrey.

### Quality floor — tiered with optional minimum

Every bid declares a `tier`: `small | medium | frontier`. Tier-to-model mapping lives in `/protocol`:

- `small` — bid-class models (Haiku, Nova Micro, Gemini Flash, GPT-5 mini)
- `medium` — mid-class models in each family
- `frontier` — top of each family (Sonnet, Nova Pro, GPT-5, Gemini 2.5 Pro)

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

Used for: (a) tie-breaking (today), (b) score-weighted auction (after ~100 tasks), (c) detecting model drift or accidental cross-contamination between the two AWS agents.

## Per-cloud agent implementation

All four agents implement the same shape, written in TypeScript on Node 22:

```
POST /bid       { task }  → { bid | no_bid }
POST /execute   { task }  → { output, actual_usage }
GET  /health
```

Internally, `/bid` is itself a small LLM call: a cheap fast model (Haiku, Nova Micro, GPT-5 mini, Gemini Flash) reads the task and outputs a structured JSON estimate. `/execute` routes to the agent's pinned production model.

| | AWS / Claude | AWS / Nova | Azure / GPT | GCP / Gemini |
|-|-|-|-|-|
| Edge | API Gateway HTTP API | API Gateway HTTP API | API Management or Function URL | Cloud Run (built-in HTTPS) |
| Compute | Lambda Node 22 (512MB) | Lambda Node 22 (512MB) | Functions Flex / Container Apps | Cloud Run (min-instances=0) |
| LLM (bid) | Bedrock — Claude Haiku | Bedrock — Nova Micro/Lite | Azure OpenAI — GPT-5 mini | Vertex AI — Gemini Flash |
| LLM (execute) | Bedrock — Claude Sonnet 4.6+ | Bedrock — Nova Pro | Azure OpenAI — GPT-5 | Vertex AI — Gemini 2.5 Pro |
| Model family lock | Anthropic only (IAM) | Amazon only (IAM) | OpenAI only | Google only |
| Secrets | Secrets Manager | Secrets Manager (separate path) | Key Vault | Secret Manager |
| Auth from coordinator | JWT (RS256) | JWT (RS256) | JWT (RS256) | JWT (RS256) |
| Logs | CloudWatch (own log group) | CloudWatch (own log group) | App Insights | Cloud Logging |

The two AWS agents must use **separate IAM roles** scoped to only their model family. The Claude agent's role can `bedrock:InvokeModel` on Anthropic models only; the Nova agent's role on Amazon models only. This is what enforces the model lock at the cloud layer rather than relying on application code.

**Model lock strictness:** family allowlist, pinned per deployment. IAM grants the entire family on Bedrock / Azure OpenAI / Vertex AI; the running code has one specific `model_id` pinned per deploy for both bid and execute. Audit log captures the exact model used. Upgrades (e.g., Sonnet 4.6 → 4.7) are a config + redeploy, not an IAM change.

## Coordinator → agent auth (signed JWT)

Single mechanism across all four agents. RS256 keypair held by the coordinator. Public key published as a JWKS document at a static S3 + CloudFront URL.

Per-task tokens:
- 60-second TTL
- `aud` = target agent ID
- `sub` = coordinator service identity
- Custom claims: `task_id`, `phase` (`bid` | `award` | `execute` | `reject`)
- Signed per request — no token reuse across phases

Each agent verifies tokens at the entrypoint (Lambda authorizer / Function middleware / Cloud Run middleware) by fetching JWKS once and caching for the rotation window. Key rotation: dual-publish in JWKS for the rotation window, switch active signing key, retire old after agents have refreshed.

## Pricing data (scheduled refresh)

Bids are denominated in USD, so per-token prices for every model in scope must be available to the bid handlers. Daily Lambda fetches and writes:

- **Source:** AWS Pricing API (Bedrock), Azure Retail Prices API, GCP Cloud Billing Catalog. For models not exposed in those APIs cleanly, fall back to maintained constants in `/protocol`.
- **Destination:** DynamoDB `pricing` table keyed by `model_id`, with `effective_date`, `price_in_usd_per_mtoken`, `price_out_usd_per_mtoken`.
- **Failure mode:** last-known-good. If a vendor fetch fails, agents continue using the previous day's prices. Job failure pages on-call (eventually); bids never block.
- **Per-task snapshot:** when a bid is recorded, the prices used are written into the bid record itself. Eval replays remain reproducible even after the table updates.
- **Quarterly review:** parsing logic is the brittle bit — vendor pages and APIs drift silently. Calendar reminder to verify the parsers still work.

## Storage (DynamoDB)

Single-table design for the ledger:
- PK: `task_id`
- SK: `<phase>#<agent_id>` for sub-records (`bid#aws-claude`, `award`, `result#aws-nova`, etc.)
- GSI on `agent_id` for per-agent rolling stats

Plus a `pricing` table (PK = `model_id`, SK = `effective_date`).

DynamoDB on-demand billing scales to zero at idle. S3 export for analytical queries (Athena) is deferred to v2 if needed.

## Observability (Grafana Cloud)

OpenTelemetry SDK in the TypeScript code, auto-instrument Lambda / Functions / Cloud Run handlers, ship to Grafana Cloud's OTLP endpoint. Free tier (50GB logs, 50GB traces, 10k metrics) covers up to ~100k tasks/mo; 14-day retention is the main constraint.

Single trace per task spans the coordinator and all four agents. Span attributes: `task_id`, `agent_id`, `phase`, `tier`, `bid_usd`, `actual_usd`, `mape`. Dashboards: per-agent win rate, MAPE distribution, decline rate by reason, bid-round latency p50/p95/p99.

## IaC (Terraform)

One root module per agent and one for the coordinator:

```
/infra/coordinator      # AWS — API Gateway, Lambda, DynamoDB, S3+CloudFront for JWKS
/agent/aws-claude/infra # AWS — separate API GW + Lambda
/agent/aws-nova/infra   # AWS — separate API GW + Lambda
/agent/azure-gpt/infra  # Azure — APIM/Functions, Key Vault
/agent/gcp-gemini/infra # GCP — Cloud Run, Secret Manager
```

State on S3 with DynamoDB locking. Three provider blocks (`aws`, `azurerm`, `google`). The two AWS agents are **not** parameterized into one stack — separation is the whole point.

## Cost model

Numbers are order-of-magnitude as of late 2025/early 2026 list pricing — recheck before committing.

**Per-task variable cost**

- Bidding: 4 small-model calls × ~500 in / ~100 out tokens ≈ **$0.0004** total. Nova Micro and Gemini Flash are near-free; Claude Haiku and GPT-5 mini set the bid-phase floor.
- Execution: only the winner runs. Typical "medium" task (4k in, 1k out): Nova Pro ~**$0.005**, Gemini 2.5 Pro ~**$0.02**, Claude Sonnet ~**$0.03**, GPT-5 ~**$0.04**. Expect Nova to win frequently on cost — that's the design working.
- Infra round-trip: API Gateway + Lambda + DynamoDB + logs ≈ **$0.00002**. Negligible.

**Cross-cloud egress.** Coordinator on AWS; Claude and Nova bid traffic is intra-AWS (free). Azure and GCP legs cross cloud boundaries. A task shipping 100KB to all four agents costs fractions of a cent; ~$180/mo at 1M tasks/mo with 1MB payloads. If attachments grow, switch to a shared S3 bucket the other clouds read via signed URLs, or send only a content hash and let agents pull.

**Monthly fixed-ish costs**

| Item | Est. monthly |
|-|-|
| 3× cloud accounts at idle (logs, KMS, secrets — AWS counts once even with 2 agents) | $5–15 |
| Coordinator (Lambda + DynamoDB + JWKS via S3+CloudFront) | $5–25 |
| Extra AWS infra for the second agent (separate API GW + Lambda + logs) | $1–5 |
| Pricing refresh Lambda (1 invocation/day) | <$1 |
| Domain + cert | ~$1 |
| Observability — Grafana Cloud free tier | $0 |
| **Floor** | **~$15–50** |

**At 1k tasks/month (hobby):** ~$25 infra + ~$20 LLM (Nova-heavy mix) = **~$45/mo**.
**At 100k tasks/month:** ~$80 infra + ~$1,500–3,500 LLM depending on win distribution = **~$1.6k–3.6k/mo**.
**At 1M tasks/month:** infra still <$600; LLM spend $15k–35k depending on which model dominates wins.

The headline: **infrastructure is rounding error vs. model tokens at any non-trivial volume.** Optimization energy belongs on bid accuracy and winning-model cost, not on Lambda vs Cloud Run.

## Operational notes

The major design questions are settled (see sections above). What remains is operational hygiene that matters in steady state:

1. **Tokenizer differences are real.** GPT, Claude, Nova, Gemini all tokenize differently. The bid model needs prompt examples calibrated to *its* tokenizer's behavior — don't share bid prompts verbatim across agents without checking.
2. **Same-operator collusion risk.** Two agents share an AWS account. The coordinator's audit log should treat them as fully independent participants and watch for correlated bidding patterns (both always under-bidding by similar amounts) as a smell of accidental cross-contamination.
3. **Latency shape.** Adaptive bid timeout caps at 5s. Cross-cloud Azure/GCP legs add ~100–200ms over the AWS-local agents. Acceptable for batch.
4. **Stochastic-bid noise.** With non-deterministic bid sampling, MAPE measurement requires averaging multiple runs of fixture tasks. Single-shot accuracy numbers are misleading.
5. **Model upgrades.** Pinned-per-deployment lock means upgrading Sonnet 4.6 → 4.7 is a config + Terraform apply. Do this for one agent at a time and watch MAPE / win rate for ~24h before moving on.
6. **Pricing parser drift.** The daily refresh job parses vendor pricing pages/APIs. These break silently — quarterly review is mandatory or you're bidding against stale prices.
7. **JWKS rotation.** Dual-publish active and incoming public keys for the rotation window (≥ token TTL × cache TTL on agents) before retiring the old one. Skipping this breaks every in-flight task.
8. **Eval harness early.** Build `/eval` before agent #2 lands. A directory of representative tasks with expected USD ranges lets you measure each agent's bid accuracy in CI before exposing the system to live traffic.

## Repo layout

```
/coordinator        # AWS-hosted, owns the auction
/agent              # shared agent code (bid/execute logic, prompt templates)
/agent/aws-claude   # Lambda handler + Terraform, Bedrock Anthropic
/agent/aws-nova     # Lambda handler + Terraform, Bedrock Amazon
/agent/azure-gpt    # Function/Container handler + Terraform, Azure OpenAI
/agent/gcp-gemini   # Cloud Run handler + Terraform, Vertex AI
/protocol           # Zod schemas for bid/execute/award/result + tier mapping + pricing fallback constants
/infra              # cross-cloud Terraform root, JWKS publication, pricing refresh Lambda
/eval               # task fixtures + scoring harness (MAPE-aware: averages over runs)
```

The two AWS agents share `/agent` core but have separate deploy roots. Do **not** factor them into a single parameterized stack — the parameter ("which model?") is the entire point of their independence.

## Build order

### Phase 1 — AWS-only (2-bidder auction)

1. **Protocol first.** Zod schemas in `/protocol` for bid / execute / award / result / no_bid. Tier mapping. Pricing constants fallback. Everything downstream depends on these.
2. **Coordinator skeleton.** Async API (`POST /tasks`, `GET /tasks/:id`), DynamoDB ledger, JWT signing + JWKS endpoint, basic auction state machine. Run with no agents — exercise the flow.
3. **First agent end-to-end: AWS / Claude.** Lambda + API Gateway + Bedrock. JWT verification at entry. Bid → execute → settle round-trip with the coordinator.
4. **Pricing refresh Lambda — AWS only.** Daily job populating the DynamoDB pricing table from the AWS Pricing API (Bedrock SKUs), with last-known-good fallback. Agent reads from it for bid USD calculation. Azure and GCP parsers come in Phase 2.
5. **Second AWS agent: Nova.** Same cloud, same IaC patterns. First time the auction has real competition; smoke-tests the same-account isolation requirements.
6. **Vickrey, tiers, decline, tie-break, re-auction.** All the auction rules now have a real testbed with two real bidders.
7. **Ledger + accuracy scoring.** MAPE rollups, decline-rate dashboards, win-rate by tier (per-agent, even with just two).
8. **Eval harness + Grafana dashboards (Phase 1 cut).** Coordinator + AWS agents instrumented; eval fixtures answering "is Claude vs Nova working as a market?"

End of Phase 1: a production-ready 2-bidder auction. Real product, just narrower than the long-term vision.

### Phase 2 — Add Azure + GCP (4-bidder auction)

9. **Pricing refresh extension.** Add Azure Retail Prices API parser and GCP Cloud Billing Catalog parser to the existing daily job.
10. **Azure / GPT, then GCP / Gemini.** Bring up cross-cloud agents one at a time so JWT verification on each cloud's edge and egress can be debugged in isolation.
11. **Cross-cloud egress dashboards + cost alarms.** Now relevant — the new bid traffic is no longer free.
12. **Eval harness expansion.** Re-baseline MAPE per agent across the four-way market.
13. **Score-weighted auction layer.** Once ~100 settled tasks of ledger data exist (mostly post-Phase-2), multiply bids by historical accuracy multipliers and observe behavior shift.

Phase 1 is buildable in two to three weeks by one person. Phase 2 adds another two to three weeks for the cross-cloud agents and pricing parsers.

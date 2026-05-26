import {
  BidResponseSchema,
  ResultSchema,
  type AgentId,
  type Bid,
  type BidResponse,
  type JwtPhase,
  type PricingEntry,
  type Result,
  type TaskId,
  type TaskSpec,
  type Tier,
  isNoBid,
  meetsMinTier,
} from "@agent-tasker/protocol";
import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import type { LedgerStore } from "../ledger/store.js";
import { recordAgentBidLatency, recordBidRoundLatency } from "../observability/market-metrics.js";
import type { TaskRecord } from "../ledger/types.js";
import type { AuctionRunner } from "./runner.js";
import { deliverCompletionWebhook, type WebhookSigner } from "./webhook-delivery.js";

// Minimal real AuctionRunner that drives `bidding → awarded → executing →
// (completed | failed)` for one task via real HTTP fan-out to each agent.
//
// What it does today:
// - Mints per-phase JWTs via the injected signer; sends them as Bearer
//   on each agent request.
// - Announces in parallel via POST {agent.baseUrl}/bid with the task spec
//   and the bid token.
// - Waits up to `bidTimeoutMs` for responses (fixed; adaptive timeout is
//   #52). Slow agents are treated as `no_bid: internal_error`.
// - Records every bid/no_bid via store.recordBidResponse with the supplied
//   pricing snapshot.
// - Applies the task's optional `min_tier` filter before winner selection.
// - Picks the winner with lowest `bid_usd`; records the auction price as
//   the second-lowest bid (Vickrey / second-price). With one bidder, the
//   auction price falls back to that bidder's own bid.
// - Awards, marks executing, POSTs to {winner.baseUrl}/execute, records
//   the result, completes.
// - Re-auctions on /execute failure by excluding the failed winner and
//   selecting from remaining eligible bids while at least two agents remain.
//
// What's still out of scope (separate issues):
// - Adaptive bid timeout (#52)

export interface AgentEndpoint {
  agentId: AgentId;
  baseUrl: string;
}

export interface TaskTokenSigner {
  sign(args: { agentId: AgentId; taskId: TaskId; phase: JwtPhase }): Promise<string>;
}

export interface HttpAuctionRunnerOptions {
  store: LedgerStore;
  agents: AgentEndpoint[];
  tokenSigner: TaskTokenSigner;
  pricingSnapshot: PricingEntry[];
  accuracyByAgent?: AgentAccuracyLookup;
  tieBreakRandom?: RandomSource;
  bidInitialWaitMs?: number;
  bidExtensionMs?: number;
  bidTimeoutMs?: number;
  executeTimeoutMs?: number;
  callbackMaxAttempts?: number;
  callbackInitialBackoffMs?: number;
  callbackSleep?: (ms: number) => Promise<void>;
  webhookSigner?: WebhookSigner;
  // Override for tests; defaults to the global `fetch` available in Node 22+.
  fetch?: typeof fetch;
  // Hook so callers can observe runs / surface errors. The runner itself
  // never throws past `start()` — every failure path is reflected in the
  // ledger.
  onError?: (taskId: TaskId, err: unknown) => void;
  // Emits one event per coordinator→agent request so cross-cloud egress can
  // be tracked by logs-based metrics and smoke-tested without live cloud IO.
  egressRecorder?: EgressRecorder;
}

const DEFAULT_BID_TIMEOUT_MS = 5_000;
const DEFAULT_BID_INITIAL_WAIT_MS = 2_000;
const DEFAULT_BID_EXTENSION_MS = 1_000;
const DEFAULT_EXECUTE_TIMEOUT_MS = 60_000;
export const EXECUTION_OVERRUN_MULTIPLIER = 10;
const COORDINATOR_TRACER = trace.getTracer("agent-tasker-coordinator");
const DEFAULT_AGENT_EGRESS_RECORDER: EgressRecorder = (event) => {
  console.log(JSON.stringify({ event: "coordinator.agent_egress_bytes", ...event }));
};

export class HttpAuctionRunner implements AuctionRunner {
  private readonly settlements = new Map<TaskId, Promise<void>>();

  constructor(private readonly opts: HttpAuctionRunnerOptions) {}

  start(taskId: TaskId): void {
    const settlement = this.runAuction(taskId).catch((err: unknown) => {
      this.opts.onError?.(taskId, err);
    });
    this.settlements.set(taskId, settlement);
  }

  // Test helper — awaits the in-flight (or completed) auction for a given
  // task. Production callers don't need this; the result is observable
  // via GET /tasks/:id.
  settle(taskId: TaskId): Promise<void> {
    return this.settlements.get(taskId) ?? Promise.resolve();
  }

  private async runAuction(taskId: TaskId): Promise<void> {
    await withSpan("coordinator.auction", { task_id: taskId }, async () => {
      await this.runAuctionInSpan(taskId);
    });
  }

  private async runAuctionInSpan(taskId: TaskId): Promise<void> {
    const task = await this.opts.store.getTask(taskId);
    if (!task) {
      // POST /tasks just created this — if it's not here something is very
      // wrong upstream. Surface via onError; nothing else to write.
      this.opts.onError?.(taskId, new Error(`task ${taskId} vanished before auction start`));
      return;
    }

    const responses = await this.gatherBids(taskId, task.spec);
    for (const response of responses) {
      await this.opts.store.recordBidResponse({
        taskId,
        response,
        pricingSnapshot: this.opts.pricingSnapshot,
      });
    }

    const realBids = responses.filter((r): r is Bid => !isNoBid(r));
    if (realBids.length === 0) {
      const reasons = responses
        .filter(isNoBid)
        .map((r) => r.reason)
        .join(", ");
      await this.opts.store.failTask({
        taskId,
        reason: `all agents declined: ${reasons || "none responded"}`,
      });
      return;
    }

    const eligibleBids = filterBidsByMinTier(realBids, task.spec.min_tier);
    if (eligibleBids.length === 0) {
      await this.opts.store.failTask({
        taskId,
        reason: `no bids met min_tier ${task.spec.min_tier ?? "none"}`,
      });
      return;
    }

    const accuracyByAgent = await this.accuracyForBids(eligibleBids);
    await this.awardAndExecuteWithReauction(taskId, task.spec, eligibleBids, accuracyByAgent);
  }

  private async awardAndExecuteWithReauction(
    taskId: TaskId,
    spec: TaskSpec,
    eligibleBids: readonly Bid[],
    accuracyByAgent: AgentAccuracyLookup,
  ): Promise<void> {
    const remainingBids = [...eligibleBids];
    const failures: string[] = [];

    while (remainingBids.length > 0) {
      const award = selectVickreyAward(remainingBids, accuracyByAgent, this.opts.tieBreakRandom);

      await this.opts.store.awardTask({
        taskId,
        winnerAgentId: award.winner.agent_id,
        auctionPriceUsd: award.auctionPriceUsd,
        winningBidUsd: award.winningBidUsd,
      });
      setActiveSpanAttributes({
        task_id: taskId,
        agent_id: award.winner.agent_id,
        phase: "award",
        tier: award.winner.tier,
        bid_usd: award.winningBidUsd,
        auction_price_usd: award.auctionPriceUsd,
        score_adjusted_bid_usd: award.scoreAdjustedWinningBidUsd,
        score_adjusted_auction_price_usd: award.scoreAdjustedAuctionPriceUsd,
      });

      await this.opts.store.markExecuting(taskId);

      try {
        const result = await this.execute(taskId, award.winner, spec);
        enforceExecutionOverrunCap(award.winner, result);
        const actualUsd = computeActualUsdFromBidPrices(award.winner, result);
        setActiveSpanAttributes({
          task_id: taskId,
          agent_id: award.winner.agent_id,
          phase: "execute",
          tier: award.winner.tier,
          bid_usd: award.winningBidUsd,
          actual_usd: actualUsd,
          mape: actualUsd > 0 ? Math.abs(award.winningBidUsd - actualUsd) / actualUsd : 0,
        });
        const completed = await this.opts.store.completeTask({ taskId, result });
        await this.deliverCallback(completed);
        return;
      } catch (err) {
        failures.push(`winner ${award.winner.agent_id} failed /execute: ${(err as Error).message}`);
        const failedIndex = remainingBids.findIndex(
          (bid) => bid.agent_id === award.winner.agent_id,
        );
        if (failedIndex >= 0) remainingBids.splice(failedIndex, 1);
        if (remainingBids.length <= 1) {
          await this.opts.store.failTask({
            taskId,
            reason: `re-auction exhausted after execute failure: ${failures.join("; ")}`,
          });
          return;
        }
      }
    }

    await this.opts.store.failTask({
      taskId,
      reason: `re-auction exhausted without an executable winner: ${failures.join("; ")}`,
    });
  }

  // Sends POST /bid to every configured agent in parallel and waits with the
  // adaptive window from AGENTS.md: 2s initial wait, +1s while responses keep
  // landing, capped at 5s total wall clock. Agents still pending at the cap
  // are translated to synthetic `no_bid: internal_error` so the ledger has a
  // record per configured participant.
  private async gatherBids(taskId: TaskId, spec: TaskSpec): Promise<BidResponse[]> {
    const fetchImpl = this.opts.fetch ?? fetch;
    const body = JSON.stringify({ task_id: taskId, spec });
    const pending = this.opts.agents.map((agent) => {
      const controller = new AbortController();
      const promise = (async (): Promise<BidResponse> => {
        const startedAt = Date.now();
        try {
          const token = await this.opts.tokenSigner.sign({
            agentId: agent.agentId,
            taskId,
            phase: "bid",
          });
          const response = await withSpan(
            "coordinator.agent.bid",
            { task_id: taskId, agent_id: agent.agentId, phase: "bid" },
            async (span) => {
              this.recordAgentEgress({
                taskId,
                agentId: agent.agentId,
                phase: "bid",
                url: `${agent.baseUrl}/bid`,
                body,
                bearerToken: token,
              });
              const res = await fetchImpl(`${agent.baseUrl}/bid`, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${token}`,
                },
                body,
                signal: controller.signal,
              });
              if (!res.ok) {
                return syntheticNoBid(taskId, agent.agentId, `agent returned ${res.status}`);
              }
              const responseBody = (await res.json()) as unknown;
              const parsed = BidResponseSchema.safeParse(responseBody);
              if (!parsed.success) {
                return syntheticNoBid(taskId, agent.agentId, "malformed bid response");
              }
              // Defend against an agent claiming to be someone else.
              const responseAgentId = "agent_id" in parsed.data ? parsed.data.agent_id : undefined;
              if (responseAgentId !== agent.agentId) {
                return syntheticNoBid(taskId, agent.agentId, "bid agent_id mismatch");
              }
              annotateBidSpan(span, parsed.data);
              return parsed.data;
            },
          );
          recordAgentBidLatency({
            agentId: agent.agentId,
            response,
            durationMs: Date.now() - startedAt,
          });
          return response;
        } catch (err) {
          const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
          const response = syntheticNoBid(taskId, agent.agentId, reason);
          recordAgentBidLatency({
            agentId: agent.agentId,
            response,
            durationMs: Date.now() - startedAt,
          });
          return response;
        }
      })();
      return {
        agentId: agent.agentId,
        abort: () => controller.abort(),
        promise,
      };
    });

    try {
      const startedAt = Date.now();
      const responses = await collectBidResponsesAdaptive({
        taskId,
        pending,
        totalTimeoutMs: this.opts.bidTimeoutMs ?? DEFAULT_BID_TIMEOUT_MS,
        initialWaitMs: this.opts.bidInitialWaitMs ?? DEFAULT_BID_INITIAL_WAIT_MS,
        extensionMs: this.opts.bidExtensionMs ?? DEFAULT_BID_EXTENSION_MS,
      });
      recordBidRoundLatency({
        durationMs: Date.now() - startedAt,
        configuredAgentCount: pending.length,
        responseCount: responses.length,
        bidCount: responses.filter((response) => !isNoBid(response)).length,
      });
      return responses;
    } finally {
      for (const entry of pending) entry.abort();
    }
  }

  private async execute(taskId: TaskId, winningBid: Bid, spec: TaskSpec) {
    const agentId = winningBid.agent_id;
    const agent = this.opts.agents.find((a) => a.agentId === agentId);
    if (!agent) {
      throw new Error(`winner ${agentId} not in agent registry`);
    }
    const token = await this.opts.tokenSigner.sign({ agentId, taskId, phase: "execute" });
    const timeoutMs = this.opts.executeTimeoutMs ?? DEFAULT_EXECUTE_TIMEOUT_MS;
    const fetchImpl = this.opts.fetch ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    const requestBody = JSON.stringify({ task_id: taskId, spec });
    try {
      res = await withSpan(
        "coordinator.agent.execute",
        {
          task_id: taskId,
          agent_id: agentId,
          phase: "execute",
          tier: winningBid.tier,
          bid_usd: winningBid.bid_usd,
        },
        async (span) => {
          this.recordAgentEgress({
            taskId,
            agentId,
            phase: "execute",
            url: `${agent.baseUrl}/execute`,
            body: requestBody,
            bearerToken: token,
          });
          const executeResponse = await fetchImpl(`${agent.baseUrl}/execute`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: requestBody,
            signal: controller.signal,
          });
          span.setAttribute("http.response.status_code", executeResponse.status);
          return executeResponse;
        },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`execute returned ${res.status}`);
    const responseBody = (await res.json()) as unknown;
    const result = ResultSchema.parse(responseBody);
    setActiveSpanAttributes({
      task_id: taskId,
      agent_id: agentId,
      phase: "execute",
      tier: winningBid.tier,
      bid_usd: winningBid.bid_usd,
      actual_usd: computeActualUsdFromBidPrices(winningBid, result),
    });
    return result;
  }

  private async accuracyForBids(bids: readonly Bid[]): Promise<AgentAccuracyLookup> {
    const accuracyByAgent: AgentAccuracyLookup = { ...(this.opts.accuracyByAgent ?? {}) };
    await Promise.all(
      bids.map(async (bid) => {
        if (accuracyByAgent[bid.agent_id] !== undefined) return;
        const rollup = await this.opts.store.getAgentMapeRollup(bid.agent_id);
        if (!rollup) return;
        accuracyByAgent[bid.agent_id] = {
          mape: rollup.mape,
          settledTaskCount: rollup.settled_task_count,
        };
      }),
    );
    return accuracyByAgent;
  }

  private recordAgentEgress({
    taskId,
    agentId,
    phase,
    url,
    body,
    bearerToken,
  }: {
    taskId: TaskId;
    agentId: AgentId;
    phase: JwtPhase;
    url: string;
    body: string;
    bearerToken: string;
  }): void {
    const target = new URL(url);
    const cloudLeg = cloudLegForAgent(agentId);
    const event: AgentEgressEvent = {
      task_id: taskId,
      agent_id: agentId,
      phase,
      cloud_leg: cloudLeg,
      cross_cloud_billable: cloudLeg !== "gcp",
      egress_class: cloudLeg === "gcp" ? "same_cloud" : "cross_cloud",
      bytes_out: estimateHttpRequestBytes({
        method: "POST",
        path: target.pathname,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bearerToken}`,
        },
        body,
      }),
    };
    (this.opts.egressRecorder ?? DEFAULT_AGENT_EGRESS_RECORDER)(event);
  }

  private async deliverCallback(task: TaskRecord): Promise<void> {
    if (!task.spec.callback_url) return;
    if (!this.opts.webhookSigner) {
      this.opts.onError?.(
        task.task_id,
        new Error("callback_url provided but no webhook signer is configured"),
      );
      return;
    }

    const result = await deliverCompletionWebhook({
      task,
      signer: this.opts.webhookSigner,
      fetch: this.opts.fetch ?? fetch,
      ...(this.opts.callbackMaxAttempts !== undefined
        ? { maxAttempts: this.opts.callbackMaxAttempts }
        : {}),
      ...(this.opts.callbackInitialBackoffMs !== undefined
        ? { initialBackoffMs: this.opts.callbackInitialBackoffMs }
        : {}),
      ...(this.opts.callbackSleep ? { sleep: this.opts.callbackSleep } : {}),
    });
    if (!result.ok) {
      this.opts.onError?.(
        task.task_id,
        new Error(`callback delivery failed after ${result.attempts} attempts: ${result.error}`),
      );
    }
  }
}

export type AgentCloudLeg = "aws" | "azure" | "gcp";

export interface AgentEgressEvent {
  task_id: TaskId;
  agent_id: AgentId;
  phase: JwtPhase;
  cloud_leg: AgentCloudLeg;
  cross_cloud_billable: boolean;
  egress_class: "cross_cloud" | "same_cloud";
  bytes_out: number;
}

export type EgressRecorder = (event: AgentEgressEvent) => void;

export function cloudLegForAgent(agentId: AgentId): AgentCloudLeg {
  if (agentId === "aws-nova") return "aws";
  if (agentId === "azure-gpt") return "azure";
  return "gcp";
}

export function estimateHttpRequestBytes({
  method,
  path,
  headers,
  body,
}: {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}): number {
  const requestLineBytes = byteLength(`${method} ${path} HTTP/1.1\r\n`);
  const headerBytes = Object.entries(headers).reduce(
    (total, [name, value]) => total + byteLength(`${name}: ${value}\r\n`),
    0,
  );
  return requestLineBytes + headerBytes + byteLength("\r\n") + byteLength(body);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function computeActualUsdFromBidPrices(bid: Bid, result: Result): number {
  return (
    (result.actual_usage.input_tokens / 1_000_000) * bid.price_in_usd_per_mtoken +
    (result.actual_usage.output_tokens / 1_000_000) * bid.price_out_usd_per_mtoken
  );
}

export function enforceExecutionOverrunCap(
  winningBid: Bid,
  result: Result,
  multiplier = EXECUTION_OVERRUN_MULTIPLIER,
): void {
  const actualUsd = computeActualUsdFromBidPrices(winningBid, result);
  const maxUsd = winningBid.bid_usd * multiplier;
  if (actualUsd > maxUsd) {
    throw new Error(
      `execution overrun exceeded ${multiplier}x bid: actual_usd=${actualUsd}, max_usd=${maxUsd}`,
    );
  }
}

export interface PendingBidResponse {
  agentId: AgentId;
  promise: Promise<BidResponse>;
  abort?: () => void;
}

export interface AdaptiveBidCollectionInput {
  taskId: TaskId;
  pending: PendingBidResponse[];
  totalTimeoutMs: number;
  initialWaitMs: number;
  extensionMs: number;
  wait?: (ms: number) => Promise<void>;
}

export async function collectBidResponsesAdaptive({
  taskId,
  pending,
  totalTimeoutMs,
  initialWaitMs,
  extensionMs,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: AdaptiveBidCollectionInput): Promise<BidResponse[]> {
  const responses = new Map<AgentId, BidResponse>();
  const unresolved = new Set(pending.map((entry) => entry.agentId));
  const allSettled = Promise.allSettled(pending.map((entry) => entry.promise));

  for (const entry of pending) {
    entry.promise.then(
      (response) => {
        if (!unresolved.has(entry.agentId)) return;
        unresolved.delete(entry.agentId);
        responses.set(entry.agentId, response);
      },
      () => {
        if (!unresolved.has(entry.agentId)) return;
        unresolved.delete(entry.agentId);
        responses.set(entry.agentId, syntheticNoBid(taskId, entry.agentId, "bid promise rejected"));
      },
    );
  }

  const start = Date.now();
  let windowMs = Math.min(initialWaitMs, totalTimeoutMs);

  while (unresolved.size > 0 && Date.now() - start < totalTimeoutMs && windowMs > 0) {
    const responseCountBeforeWindow = responses.size;
    await Promise.race([wait(windowMs), allSettled]);
    await Promise.resolve();

    const landedThisWindow = responses.size > responseCountBeforeWindow;
    if (!shouldExtendBidWindow(responses, landedThisWindow, unresolved.size)) break;

    const elapsed = Date.now() - start;
    windowMs = Math.min(extensionMs, totalTimeoutMs - elapsed);
  }

  for (const entry of pending) {
    if (!responses.has(entry.agentId)) {
      unresolved.delete(entry.agentId);
      entry.abort?.();
      responses.set(entry.agentId, syntheticNoBid(taskId, entry.agentId, "adaptive timeout"));
    }
  }

  return pending.map((entry) => responses.get(entry.agentId)!);
}

function shouldExtendBidWindow(
  responses: ReadonlyMap<AgentId, BidResponse>,
  landedThisWindow: boolean,
  unresolvedCount: number,
): boolean {
  const realBidCount = Array.from(responses.values()).filter(
    (response) => !isNoBid(response),
  ).length;
  return unresolvedCount > 0 && realBidCount >= 2 && landedThisWindow;
}

function syntheticNoBid(taskId: TaskId, agentId: AgentId, reason: string): BidResponse {
  // `reason` here is descriptive but must map to the protocol's enum —
  // anything outside `context_overflow | policy | capability |
  // internal_error` is bucketed under `internal_error`. The richer free-form
  // reason lives in the audit log (TODO: structured logging in #73).
  void reason;
  return {
    task_id: taskId,
    agent_id: agentId,
    status: "no_bid",
    reason: "internal_error",
  };
}

export interface VickreyAward {
  winner: Bid;
  winningBidUsd: number;
  auctionPriceUsd: number;
  scoreAdjustedWinningBidUsd: number;
  scoreAdjustedAuctionPriceUsd: number;
}

export interface AgentAccuracy {
  // Mean absolute percentage error, lower is better.
  mape: number;
  settledTaskCount: number;
}

export type AgentAccuracyLookup = Partial<Record<AgentId, AgentAccuracy>>;
export type RandomSource = () => number;

export const MIN_SETTLED_TASKS_FOR_MAPE_TIE_BREAK = 10;
export const MIN_SETTLED_TASKS_FOR_SCORE_WEIGHTING = 100;

export function filterBidsByMinTier(bids: readonly Bid[], minTier: Tier | undefined): Bid[] {
  return bids.filter((bid) => meetsMinTier(bid.tier, minTier));
}

export function selectVickreyAward(
  bids: readonly Bid[],
  accuracyByAgent: AgentAccuracyLookup = {},
  random: RandomSource = Math.random,
): VickreyAward {
  if (bids.length === 0) {
    throw new Error("cannot select a Vickrey award without at least one bid");
  }

  const scoredBids = bids.map((bid) => ({
    bid,
    scoreAdjustedBidUsd: scoreAdjustedBidUsd(bid, accuracyByAgent),
  }));
  const rankedByBid = scoredBids.sort((a, b) => a.scoreAdjustedBidUsd - b.scoreAdjustedBidUsd);
  const lowestAdjustedBidUsd = rankedByBid[0]!.scoreAdjustedBidUsd;
  const tiedLowestBids = rankedByBid
    .filter((entry) => entry.scoreAdjustedBidUsd === lowestAdjustedBidUsd)
    .map((entry) => entry.bid);
  const winner =
    tiedLowestBids.length === 1
      ? tiedLowestBids[0]!
      : pickTieWinner(tiedLowestBids, accuracyByAgent, random);
  const priceEntry = rankedByBid.filter((entry) => entry.bid !== winner)[0] ?? rankedByBid[0]!;
  const winningAdjustedBidUsd = scoreAdjustedBidUsd(winner, accuracyByAgent);

  return {
    winner,
    winningBidUsd: winner.bid_usd,
    auctionPriceUsd: priceEntry.bid.bid_usd,
    scoreAdjustedWinningBidUsd: winningAdjustedBidUsd,
    scoreAdjustedAuctionPriceUsd: priceEntry.scoreAdjustedBidUsd,
  };
}

export function bidAccuracyMultiplier(accuracy: AgentAccuracy | undefined): number {
  if (!accuracy || !hasEnoughSettledTasksForScoreWeighting(accuracy)) return 1;
  return 1 + accuracy.mape;
}

function scoreAdjustedBidUsd(bid: Bid, accuracyByAgent: AgentAccuracyLookup): number {
  return bid.bid_usd * bidAccuracyMultiplier(accuracyByAgent[bid.agent_id]);
}

function pickTieWinner(
  tiedBids: readonly Bid[],
  accuracyByAgent: AgentAccuracyLookup,
  random: RandomSource,
): Bid {
  const coldStartBids = tiedBids.filter(
    (bid) => !hasEnoughSettledTasks(accuracyByAgent[bid.agent_id]),
  );
  if (coldStartBids.length > 0) {
    return pickRandom(coldStartBids, random);
  }

  return [...tiedBids].sort(
    (a, b) => accuracyByAgent[a.agent_id]!.mape - accuracyByAgent[b.agent_id]!.mape,
  )[0]!;
}

function hasEnoughSettledTasks(accuracy: AgentAccuracy | undefined): boolean {
  return (
    accuracy !== undefined && accuracy.settledTaskCount >= MIN_SETTLED_TASKS_FOR_MAPE_TIE_BREAK
  );
}

function hasEnoughSettledTasksForScoreWeighting(accuracy: AgentAccuracy | undefined): boolean {
  return (
    accuracy !== undefined && accuracy.settledTaskCount >= MIN_SETTLED_TASKS_FOR_SCORE_WEIGHTING
  );
}

function pickRandom<T>(items: readonly T[], random: RandomSource): T {
  const index = Math.min(Math.floor(random() * items.length), items.length - 1);
  return items[index]!;
}

async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return COORDINATOR_TRACER.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      if (err instanceof Error) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      } else {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      }
      throw err;
    } finally {
      span.end();
    }
  });
}

function setActiveSpanAttributes(attributes: Attributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}

function annotateBidSpan(span: Span, response: BidResponse): void {
  if (isNoBid(response)) {
    span.setAttributes({
      task_id: response.task_id,
      agent_id: response.agent_id,
      phase: "bid",
      no_bid_reason: response.reason,
    });
    return;
  }

  span.setAttributes({
    task_id: response.task_id,
    agent_id: response.agent_id,
    phase: "bid",
    tier: response.tier,
    bid_usd: response.bid_usd,
  });
}

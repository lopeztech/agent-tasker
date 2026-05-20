import {
  BidResponseSchema,
  ResultSchema,
  type AgentId,
  type Bid,
  type BidResponse,
  type JwtPhase,
  type PricingEntry,
  type TaskId,
  isNoBid,
} from "@agent-tasker/protocol";
import type { LedgerStore } from "../ledger/store.js";
import type { AuctionRunner } from "./runner.js";

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
// - Picks the winner with lowest `bid_usd`. Full Vickrey (second-price)
//   selection lands with #47; for now the auction_price IS the winning
//   bid (degenerate Vickrey for two-or-fewer bidders).
// - Awards, marks executing, POSTs to {winner.baseUrl}/execute, records
//   the result, completes.
// - Any unrecoverable failure → store.failTask. Re-auction on /execute
//   failure is #53.
//
// What's still out of scope (separate issues):
// - Adaptive bid timeout (#52)
// - Real Vickrey second-price selection (#47)
// - MAPE-based tie-breaking (#50, #51)
// - Re-auction on /execute failure (#53)
// - Score-weighted auction layer (#81)

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
  bidTimeoutMs?: number;
  executeTimeoutMs?: number;
  // Override for tests; defaults to the global `fetch` available in Node 22+.
  fetch?: typeof fetch;
  // Hook so callers can observe runs / surface errors. The runner itself
  // never throws past `start()` — every failure path is reflected in the
  // ledger.
  onError?: (taskId: TaskId, err: unknown) => void;
}

const DEFAULT_BID_TIMEOUT_MS = 5_000;
const DEFAULT_EXECUTE_TIMEOUT_MS = 60_000;

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
    const task = await this.opts.store.getTask(taskId);
    if (!task) {
      // POST /tasks just created this — if it's not here something is very
      // wrong upstream. Surface via onError; nothing else to write.
      this.opts.onError?.(taskId, new Error(`task ${taskId} vanished before auction start`));
      return;
    }

    const responses = await this.gatherBids(taskId);
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

    const winner = pickLowestBid(realBids);
    const auctionPriceUsd = pickAuctionPrice(realBids, winner);

    await this.opts.store.awardTask({
      taskId,
      winnerAgentId: winner.agent_id,
      auctionPriceUsd,
      winningBidUsd: winner.bid_usd,
    });

    await this.opts.store.markExecuting(taskId);

    try {
      const result = await this.execute(taskId, winner.agent_id);
      await this.opts.store.completeTask({ taskId, result });
    } catch (err) {
      await this.opts.store.failTask({
        taskId,
        reason: `winner ${winner.agent_id} failed /execute: ${(err as Error).message}`,
      });
    }
  }

  // Sends POST /bid to every configured agent in parallel and returns one
  // BidResponse per agent. Agents that error / time out / return junk are
  // translated to a synthetic `no_bid: internal_error` so the ledger has a
  // record per agent.
  private async gatherBids(taskId: TaskId): Promise<BidResponse[]> {
    const timeoutMs = this.opts.bidTimeoutMs ?? DEFAULT_BID_TIMEOUT_MS;
    const fetchImpl = this.opts.fetch ?? fetch;
    return Promise.all(
      this.opts.agents.map(async (agent): Promise<BidResponse> => {
        try {
          const token = await this.opts.tokenSigner.sign({
            agentId: agent.agentId,
            taskId,
            phase: "bid",
          });
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          let res: Response;
          try {
            res = await fetchImpl(`${agent.baseUrl}/bid`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ task_id: taskId }),
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timer);
          }
          if (!res.ok) {
            return syntheticNoBid(taskId, agent.agentId, `agent returned ${res.status}`);
          }
          const body = (await res.json()) as unknown;
          const parsed = BidResponseSchema.safeParse(body);
          if (!parsed.success) {
            return syntheticNoBid(taskId, agent.agentId, "malformed bid response");
          }
          // Defend against an agent claiming to be someone else.
          const responseAgentId = "agent_id" in parsed.data ? parsed.data.agent_id : undefined;
          if (responseAgentId !== agent.agentId) {
            return syntheticNoBid(taskId, agent.agentId, "bid agent_id mismatch");
          }
          return parsed.data;
        } catch (err) {
          const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
          return syntheticNoBid(taskId, agent.agentId, reason);
        }
      }),
    );
  }

  private async execute(taskId: TaskId, agentId: AgentId) {
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
    try {
      res = await fetchImpl(`${agent.baseUrl}/execute`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ task_id: taskId }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`execute returned ${res.status}`);
    const body = (await res.json()) as unknown;
    return ResultSchema.parse(body);
  }
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

function pickLowestBid(bids: Bid[]): Bid {
  // Defensive: bids is non-empty by caller contract.
  return bids.reduce((min, b) => (b.bid_usd < min.bid_usd ? b : min));
}

function pickAuctionPrice(bids: Bid[], winner: Bid): number {
  // Vickrey: price = second-lowest bid. With a single bidder, the winner's
  // own bid is the price (degenerate Vickrey). Full implementation with
  // tier filtering + tie-breaking comes via #47.
  const others = bids.filter((b) => b !== winner).map((b) => b.bid_usd);
  if (others.length === 0) return winner.bid_usd;
  return Math.min(...others);
}

import { metrics, type UpDownCounter } from "@opentelemetry/api";
import type { AgentId, Tier } from "@agent-tasker/protocol";

interface MarketMetricInstruments {
  bids: UpDownCounter;
  wins: UpDownCounter;
}

let instruments: MarketMetricInstruments | undefined;

export interface AgentTierMetricDelta {
  agentId: AgentId;
  tier: Tier;
  delta: number;
}

export function recordBidDeltas(deltas: readonly AgentTierMetricDelta[]): void {
  if (deltas.length === 0) return;
  const { bids } = getInstruments();
  for (const delta of deltas) {
    bids.add(delta.delta, {
      agent_id: delta.agentId,
      tier: delta.tier,
    });
  }
}

export function recordWin(agentId: AgentId, tier: Tier): void {
  getInstruments().wins.add(1, {
    agent_id: agentId,
    tier,
  });
}

function getInstruments(): MarketMetricInstruments {
  if (instruments) return instruments;

  const meter = metrics.getMeter("agent-tasker-coordinator-market");
  instruments = {
    bids: meter.createUpDownCounter("agent_tasker_agent_bids", {
      description: "Current count of accepted bid records by agent and tier.",
      unit: "{bid}",
    }),
    wins: meter.createUpDownCounter("agent_tasker_agent_wins", {
      description: "Current count of settled winning tasks by agent and tier.",
      unit: "{win}",
    }),
  };
  return instruments;
}

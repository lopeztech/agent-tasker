import { metrics, type Counter, type Histogram, type UpDownCounter } from "@opentelemetry/api";
import type { AgentId, Tier } from "@agent-tasker/protocol";
import type { BidAccuracySample } from "../ledger/mape.js";

interface MarketMetricInstruments {
  bids: UpDownCounter;
  wins: UpDownCounter;
  bidAccuracySamples: Counter;
  bidAbsolutePercentageErrorSum: Counter;
  bidSignedPercentageErrorSum: UpDownCounter;
  bidAbsolutePercentageError: Histogram;
}

let instruments: MarketMetricInstruments | undefined;

export interface AgentTierMetricDelta {
  agentId: AgentId;
  tier: Tier;
  delta: number;
}

export interface AgentBidAccuracyMetric {
  agentId: AgentId;
  tier: Tier;
  sample: BidAccuracySample;
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

export function recordBidAccuracySample(metric: AgentBidAccuracyMetric): void {
  const {
    bidAccuracySamples,
    bidAbsolutePercentageError,
    bidAbsolutePercentageErrorSum,
    bidSignedPercentageErrorSum,
  } = getInstruments();
  const attributes = {
    agent_id: metric.agentId,
    tier: metric.tier,
  };
  bidAccuracySamples.add(1, attributes);
  bidAbsolutePercentageError.record(metric.sample.absolutePercentageError, attributes);
  bidAbsolutePercentageErrorSum.add(metric.sample.absolutePercentageError, attributes);
  bidSignedPercentageErrorSum.add(metric.sample.signedPercentageError, attributes);
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
    bidAccuracySamples: meter.createCounter("agent_tasker_bid_accuracy_samples", {
      description: "Count of settled tasks with bid accuracy samples.",
      unit: "{sample}",
    }),
    bidAbsolutePercentageErrorSum: meter.createCounter(
      "agent_tasker_bid_absolute_percentage_error_sum",
      {
        description: "Cumulative absolute percentage error for settled winning bids.",
        unit: "1",
      },
    ),
    bidSignedPercentageErrorSum: meter.createUpDownCounter(
      "agent_tasker_bid_signed_percentage_error_sum",
      {
        description:
          "Cumulative signed percentage error for settled winning bids; positive means actual cost exceeded the bid.",
        unit: "1",
      },
    ),
    bidAbsolutePercentageError: meter.createHistogram(
      "agent_tasker_bid_absolute_percentage_error",
      {
        description: "Distribution of absolute percentage error for settled winning bids.",
        unit: "1",
      },
    ),
  };
  return instruments;
}

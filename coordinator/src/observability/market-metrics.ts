import { metrics, type Counter, type Histogram, type UpDownCounter } from "@opentelemetry/api";
import { isNoBid, type AgentId, type BidResponse, type Tier } from "@agent-tasker/protocol";
import type { BidAccuracySample } from "../ledger/mape.js";

interface MarketMetricInstruments {
  bids: UpDownCounter;
  wins: UpDownCounter;
  bidAccuracySamples: Counter;
  bidAbsolutePercentageErrorSum: Counter;
  bidSignedPercentageErrorSum: UpDownCounter;
  bidAbsolutePercentageError: Histogram;
  agentBidLatencyMs: Histogram;
  bidRoundLatencyMs: Histogram;
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

export interface AgentBidLatencyMetric {
  agentId: AgentId;
  response: BidResponse;
  durationMs: number;
}

export interface BidRoundLatencyMetric {
  durationMs: number;
  configuredAgentCount: number;
  responseCount: number;
  bidCount: number;
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

export function recordAgentBidLatency(metric: AgentBidLatencyMetric): void {
  getInstruments().agentBidLatencyMs.record(metric.durationMs, {
    agent_id: metric.agentId,
    response_kind: isNoBid(metric.response) ? "no_bid" : "bid",
    ...(isNoBid(metric.response) ? { no_bid_reason: metric.response.reason } : {}),
  });
}

export function recordBidRoundLatency(metric: BidRoundLatencyMetric): void {
  getInstruments().bidRoundLatencyMs.record(metric.durationMs, {
    configured_agent_count: metric.configuredAgentCount,
    response_count: metric.responseCount,
    bid_count: metric.bidCount,
  });
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
    agentBidLatencyMs: meter.createHistogram("agent_tasker_agent_bid_latency_ms", {
      description: "Coordinator-observed latency for each agent /bid request.",
      unit: "ms",
    }),
    bidRoundLatencyMs: meter.createHistogram("agent_tasker_bid_round_latency_ms", {
      description: "Coordinator-observed latency for the full adaptive bid collection window.",
      unit: "ms",
    }),
  };
  return instruments;
}

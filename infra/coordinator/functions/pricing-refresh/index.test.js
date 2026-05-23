import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGcpCatalogPrices } from "./catalog.js";

function sku(description, units, nanos, usageUnit = "1,000,000 tokens") {
  return {
    description,
    category: {
      resourceFamily: "AI Platform",
      resourceGroup: "Vertex AI",
      usageType: "OnDemand",
    },
    pricingInfo: [
      {
        pricingExpression: {
          usageUnit,
          usageUnitDescription: usageUnit,
          tieredRates: [{ unitPrice: { currencyCode: "USD", units, nanos } }],
        },
      },
    ],
  };
}

describe("parseGcpCatalogPrices", () => {
  it("maps Vertex AI Gemini input and output token SKUs to canonical model ids", () => {
    const prices = parseGcpCatalogPrices([
      sku("Vertex AI Gemini 2.5 Flash input tokens", 0, 300_000_000),
      sku("Vertex AI Gemini 2.5 Flash output tokens", 2, 500_000_000),
      sku("Vertex AI Gemini 2.5 Pro input tokens", 1, 250_000_000),
      sku("Vertex AI Gemini 2.5 Pro output tokens", 10, 0),
      sku("Vertex AI unrelated embedding tokens", 0, 100_000_000),
    ]);

    assert.deepEqual(prices, {
      "gemini-2-5-flash": {
        in: 0.3,
        out: 2.5,
        source: "gcp-cloud-billing-catalog",
      },
      "gemini-2-5-pro": {
        in: 1.25,
        out: 10,
        source: "gcp-cloud-billing-catalog",
      },
    });
  });

  it("normalizes per-token SKUs to USD per million tokens", () => {
    const prices = parseGcpCatalogPrices([
      sku("Vertex AI Gemini 2.5 Flash input token", 0, 3_000_000, "token"),
      sku("Vertex AI Gemini 2.5 Flash output token", 0, 25_000_000, "token"),
    ]);

    assert.equal(prices["gemini-2-5-flash"].in, 3000);
    assert.equal(prices["gemini-2-5-flash"].out, 25000);
  });

  it("captures GAEP platform consumption SKUs when exposed by the catalog", () => {
    const prices = parseGcpCatalogPrices([
      sku("Gemini Enterprise Agent Platform request consumption", 0, 120_000_000, "request"),
    ]);

    assert.deepEqual(prices["gemini-enterprise-agent-platform"], {
      in: 0.12,
      out: 0.12,
      source: "gcp-cloud-billing-catalog",
    });
  });
});

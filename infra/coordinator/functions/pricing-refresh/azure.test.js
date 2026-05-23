import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchAzureOpenAiPrices, parseAzureOpenAiPrices } from "./azure.js";

function item(model, direction, unitPrice, unitOfMeasure = "1K Tokens") {
  return {
    serviceName: "Azure OpenAI Service",
    productName: `Azure OpenAI ${model}`,
    skuName: model,
    meterName: `${model} ${direction} Tokens`,
    unitPrice,
    unitOfMeasure,
  };
}

describe("parseAzureOpenAiPrices", () => {
  it("maps GPT-5 retail prices to canonical model ids", () => {
    const prices = parseAzureOpenAiPrices([
      item("GPT-5 Mini", "Input", 0.00025),
      item("GPT-5 Mini", "Output", 0.002),
      item("GPT-5", "Input", 0.00125),
      item("GPT-5", "Output", 0.01),
      item("GPT-4o", "Input", 0.0025),
    ]);

    assert.deepEqual(prices, {
      "gpt-5-mini": { in: 0.25, out: 2, source: "azure-retail-prices" },
      "gpt-5": { in: 1.25, out: 10, source: "azure-retail-prices" },
    });
  });

  it("follows Azure Retail Prices pagination", async () => {
    const seen = [];
    const prices = await fetchAzureOpenAiPrices(async (url) => {
      seen.push(url.toString());
      if (seen.length === 1) {
        return Response.json({
          Items: [item("GPT-5 Mini", "Input", 0.00025)],
          NextPageLink: "https://prices.azure.com/api/retail/prices?page=2",
        });
      }
      return Response.json({
        Items: [item("GPT-5 Mini", "Output", 0.002)],
      });
    });

    assert.equal(seen.length, 2);
    assert.deepEqual(prices["gpt-5-mini"], {
      in: 0.25,
      out: 2,
      source: "azure-retail-prices",
    });
  });

  it("throws when the retail prices fetch fails", async () => {
    await assert.rejects(
      fetchAzureOpenAiPrices(async () => new Response("{}", { status: 502 })),
      /Azure Retail Prices API failed with HTTP 502/,
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchAwsBedrockPrices, parseAwsBedrockPrices } from "./aws.js";

function product(modelName, sku) {
  return [
    sku,
    {
      productFamily: "Text Generation",
      attributes: {
        servicecode: "AmazonBedrock",
        modelName,
        group: "Bedrock model inference",
        usagetype: `${modelName.replaceAll(" ", "")}-InputTokens`,
      },
    },
  ];
}

function dimension(description, usd, unit = "1K tokens") {
  return {
    description,
    unit,
    pricePerUnit: { USD: usd },
  };
}

function term(inputDescription, inputUsd, outputDescription, outputUsd) {
  return {
    offer: {
      priceDimensions: {
        in: dimension(inputDescription, inputUsd),
        out: dimension(outputDescription, outputUsd),
      },
    },
  };
}

describe("parseAwsBedrockPrices", () => {
  it("maps Nova input and output token prices to canonical model ids", () => {
    const priceList = {
      products: Object.fromEntries([
        product("Amazon Nova Micro", "NOVA_MICRO"),
        product("Amazon Nova Lite", "NOVA_LITE"),
        product("Amazon Nova Pro", "NOVA_PRO"),
        product("Titan Embeddings", "TITAN"),
      ]),
      terms: {
        OnDemand: {
          NOVA_MICRO: term(
            "Amazon Nova Micro input tokens per 1K tokens",
            "0.000035",
            "Amazon Nova Micro output tokens per 1K tokens",
            "0.00014",
          ),
          NOVA_LITE: term(
            "Amazon Nova Lite input tokens per 1K tokens",
            "0.00006",
            "Amazon Nova Lite output tokens per 1K tokens",
            "0.00024",
          ),
          NOVA_PRO: term(
            "Amazon Nova Pro input tokens per 1K tokens",
            "0.0008",
            "Amazon Nova Pro output tokens per 1K tokens",
            "0.0032",
          ),
        },
      },
    };

    assert.deepEqual(parseAwsBedrockPrices(priceList), {
      "amazon.nova-micro": { in: 0.035, out: 0.14, source: "aws-price-list" },
      "amazon.nova-lite": { in: 0.06, out: 0.24, source: "aws-price-list" },
      "amazon.nova-pro": { in: 0.8, out: 3.2, source: "aws-price-list" },
    });
  });

  it("throws when the public price list fetch fails", async () => {
    await assert.rejects(
      fetchAwsBedrockPrices(async () => new Response("{}", { status: 503 })),
      /AWS Bedrock price list failed with HTTP 503/,
    );
  });
});

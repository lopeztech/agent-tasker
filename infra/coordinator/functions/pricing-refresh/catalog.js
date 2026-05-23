const GCP_PRICING_TARGETS = [
  {
    modelId: "gemini-2-5-flash",
    modelPatterns: [/gemini\s*2(?:\.|-)?5\s*flash/i, /gemini-2\.5-flash/i],
  },
  {
    modelId: "gemini-2-5-pro",
    modelPatterns: [/gemini\s*2(?:\.|-)?5\s*pro/i, /gemini-2\.5-pro/i],
  },
  {
    modelId: "gemini-enterprise-agent-platform",
    modelPatterns: [
      /gemini enterprise agent platform/i,
      /\bgaep\b/i,
      /vertex ai agent/i,
      /agent engine/i,
    ],
    platform: true,
  },
];

function moneyToNumber(money) {
  const units = Number(money?.units ?? 0);
  const nanos = Number(money?.nanos ?? 0);
  return units + nanos / 1_000_000_000;
}

function pricePerMtoken(pricingExpression) {
  const tieredRates = pricingExpression?.tieredRates ?? [];
  const firstRate = tieredRates[0];
  if (!firstRate?.unitPrice) return undefined;

  const unitPrice = moneyToNumber(firstRate.unitPrice);
  const unitText = [
    pricingExpression.usageUnit,
    pricingExpression.usageUnitDescription,
    pricingExpression.baseUnit,
    pricingExpression.baseUnitDescription,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/1,?000,?000|million|mtok|m token/.test(unitText)) return unitPrice;
  if (/1,?000|thousand|k token/.test(unitText)) return unitPrice * 1_000;
  if (/\btoken(s)?\b/.test(unitText)) return unitPrice * 1_000_000;
  return unitPrice;
}

function skuUnitPricePerMtoken(sku) {
  const pricingInfo = sku.pricingInfo ?? [];
  for (const info of pricingInfo) {
    const expression = info.pricingExpression;
    if (expression?.usageUnit && !/token|character|request|operation/i.test(expression.usageUnit)) {
      continue;
    }
    const price = pricePerMtoken(expression);
    if (price !== undefined) return price;
  }
  return undefined;
}

function classifySku(sku) {
  const text = [
    sku.description,
    sku.category?.resourceFamily,
    sku.category?.resourceGroup,
    sku.category?.usageType,
    sku.serviceRegions?.join(" "),
  ]
    .filter(Boolean)
    .join(" ");

  const target = GCP_PRICING_TARGETS.find((candidate) =>
    candidate.modelPatterns.some((pattern) => pattern.test(text)),
  );
  if (!target) return undefined;

  if (/input|prompt|cache\s*read/i.test(text)) return { modelId: target.modelId, direction: "in" };
  if (/output|completion|response|generated/i.test(text)) {
    return { modelId: target.modelId, direction: "out" };
  }
  if (target.platform && /request|operation|consumption|tool|step/i.test(text)) {
    return { modelId: target.modelId, direction: "platform" };
  }
  return undefined;
}

export function parseGcpCatalogPrices(skus) {
  const collected = {};

  for (const sku of skus) {
    const classification = classifySku(sku);
    if (!classification) continue;

    const price = skuUnitPricePerMtoken(sku);
    if (price === undefined) continue;

    collected[classification.modelId] ??= {};
    if (classification.direction === "platform") {
      collected[classification.modelId].in ??= price;
      collected[classification.modelId].out ??= price;
    } else {
      collected[classification.modelId][classification.direction] ??= price;
    }
  }

  return Object.fromEntries(
    Object.entries(collected)
      .filter(([, prices]) => prices.in !== undefined && prices.out !== undefined)
      .map(([modelId, prices]) => [
        modelId,
        { in: prices.in, out: prices.out, source: "gcp-cloud-billing-catalog" },
      ]),
  );
}

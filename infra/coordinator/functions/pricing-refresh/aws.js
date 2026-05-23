const AWS_BEDROCK_PRICE_LIST_URL =
  "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/index.json";

const NOVA_TARGETS = [
  { modelId: "amazon.nova-micro", patterns: [/nova\s*micro/i] },
  { modelId: "amazon.nova-lite", patterns: [/nova\s*lite/i] },
  { modelId: "amazon.nova-pro", patterns: [/nova\s*pro/i] },
];

function findTarget(text) {
  return NOVA_TARGETS.find((target) => target.patterns.some((pattern) => pattern.test(text)));
}

function classifyDirection(text) {
  if (/input|prompt/i.test(text)) return "in";
  if (/output|completion|response|generated/i.test(text)) return "out";
  return undefined;
}

function priceToNumber(pricePerUnit) {
  const usd = pricePerUnit?.USD;
  if (usd === undefined) return undefined;
  const parsed = Number(usd);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeToMtoken(price, unitText) {
  const text = unitText.toLowerCase();
  let normalized;
  if (/1,?000,?000|million|mtok|m token/.test(text)) return price;
  if (/1,?000|thousand|1k|k token/.test(text)) normalized = price * 1_000;
  else if (/\btoken(s)?\b/.test(text)) normalized = price * 1_000_000;
  else normalized = price;
  return Math.round(normalized * 1_000_000_000_000) / 1_000_000_000_000;
}

function productText(product) {
  const attrs = product.attributes ?? {};
  return [
    product.productFamily,
    attrs.modelName,
    attrs.group,
    attrs.groupDescription,
    attrs.operation,
    attrs.usagetype,
    attrs.usageType,
  ]
    .filter(Boolean)
    .join(" ");
}

function dimensionsForSku(priceList, sku) {
  const terms = priceList.terms?.OnDemand?.[sku] ?? {};
  return Object.values(terms).flatMap((term) => Object.values(term.priceDimensions ?? {}));
}

export function parseAwsBedrockPrices(priceList) {
  const collected = {};

  for (const [sku, product] of Object.entries(priceList.products ?? {})) {
    const baseText = productText(product);
    const target = findTarget(baseText);
    if (!target) continue;

    for (const dimension of dimensionsForSku(priceList, sku)) {
      const dimensionOnlyText = [dimension.description, dimension.unit, dimension.rateCode]
        .filter(Boolean)
        .join(" ");
      const dimensionText = [baseText, dimensionOnlyText].filter(Boolean).join(" ");
      const direction = classifyDirection(dimensionOnlyText) ?? classifyDirection(baseText);
      if (!direction) continue;

      const price = priceToNumber(dimension.pricePerUnit);
      if (price === undefined) continue;

      collected[target.modelId] ??= {};
      collected[target.modelId][direction] ??= normalizeToMtoken(price, dimensionText);
    }
  }

  return Object.fromEntries(
    Object.entries(collected)
      .filter(([, prices]) => prices.in !== undefined && prices.out !== undefined)
      .map(([modelId, prices]) => [
        modelId,
        { in: prices.in, out: prices.out, source: "aws-price-list" },
      ]),
  );
}

export async function fetchAwsBedrockPrices(fetchImpl = fetch) {
  const response = await fetchImpl(AWS_BEDROCK_PRICE_LIST_URL);
  if (!response.ok) {
    throw new Error(`AWS Bedrock price list failed with HTTP ${response.status}`);
  }

  return parseAwsBedrockPrices(await response.json());
}

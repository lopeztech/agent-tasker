const AZURE_RETAIL_PRICES_URL = "https://prices.azure.com/api/retail/prices";

const AZURE_OPENAI_FILTER =
  "serviceName eq 'Azure OpenAI' or serviceName eq 'Azure OpenAI Service'";

const GPT_TARGETS = [
  { modelId: "gpt-5-mini", patterns: [/gpt[-\s]?5[-\s]?mini/i] },
  { modelId: "gpt-5", patterns: [/gpt[-\s]?5(?![-\s]?mini)/i] },
];

function findTarget(text) {
  return GPT_TARGETS.find((target) => target.patterns.some((pattern) => pattern.test(text)));
}

function classifyDirection(text) {
  if (/input|prompt/i.test(text)) return "in";
  if (/output|completion|response|generated/i.test(text)) return "out";
  return undefined;
}

function normalizeToMtoken(price, unitText) {
  const text = unitText.toLowerCase();
  let normalized;
  if (/1,?000,?000|million|mtok|m token/.test(text)) normalized = price;
  else if (/1,?000|thousand|1k|k token/.test(text)) normalized = price * 1_000;
  else if (/\btoken(s)?\b/.test(text)) normalized = price * 1_000_000;
  else normalized = price;
  return Math.round(normalized * 1_000_000_000_000) / 1_000_000_000_000;
}

function itemText(item) {
  return [
    item.productName,
    item.skuName,
    item.meterName,
    item.armSkuName,
    item.serviceName,
    item.type,
  ]
    .filter(Boolean)
    .join(" ");
}

export function parseAzureOpenAiPrices(items) {
  const collected = {};

  for (const item of items) {
    const text = itemText(item);
    const target = findTarget(text);
    if (!target) continue;

    const direction = classifyDirection(text);
    if (!direction) continue;
    if (item.unitPrice === undefined || item.unitPrice === null) continue;

    collected[target.modelId] ??= {};
    collected[target.modelId][direction] ??= normalizeToMtoken(
      Number(item.unitPrice),
      [text, item.unitOfMeasure].join(" "),
    );
  }

  return Object.fromEntries(
    Object.entries(collected)
      .filter(([, prices]) => prices.in !== undefined && prices.out !== undefined)
      .map(([modelId, prices]) => [
        modelId,
        { in: prices.in, out: prices.out, source: "azure-retail-prices" },
      ]),
  );
}

export async function fetchAzureOpenAiPrices(fetchImpl = fetch) {
  const items = [];
  let nextUrl = new URL(AZURE_RETAIL_PRICES_URL);
  nextUrl.searchParams.set("$filter", AZURE_OPENAI_FILTER);

  while (nextUrl) {
    const response = await fetchImpl(nextUrl);
    if (!response.ok) {
      throw new Error(`Azure Retail Prices API failed with HTTP ${response.status}`);
    }

    const body = await response.json();
    items.push(...(body.Items ?? []));
    nextUrl = body.NextPageLink ? new URL(body.NextPageLink) : undefined;
  }

  return parseAzureOpenAiPrices(items);
}

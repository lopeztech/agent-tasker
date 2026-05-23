// Daily pricing-refresh handler. Writes per-model price snapshots to
// Firestore at `pricing/{model_id}/snapshots/{YYYY-MM-DD}` plus a
// `pricing/{model_id}` "latest" doc the coordinator and bidders can read
// without an extra collection-group query.
//
// Scope today: reads live GCP Cloud Billing Catalog SKUs for Vertex AI
// Gemini and GAEP where exposed, then merges them over FALLBACK_PRICING
// constants (CLAUDE.md "for SKUs not exposed cleanly in [the Catalog API],
// fall back to maintained constants in /protocol").
//
// Last-known-good behaviour (#39): per-day snapshots are append-only —
// writes upsert `pricing/{model}/snapshots/{date}` so today's failure
// doesn't disturb yesterday's snapshot. The `pricing/{model}` latest doc
// is only updated for models that succeeded; failed models keep yesterday's
// prices visible to bidders.
//
// HTTP-triggered gen-2 function. Cloud Scheduler invokes daily with OIDC
// (verified by Cloud Run's IAM layer before reaching this handler).

import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth } from "google-auth-library";
import { parseGcpCatalogPrices } from "./catalog.js";

const CATALOG_BASE_URL = "https://cloudbilling.googleapis.com/v1";

// Hand-maintained copy of /protocol/src/pricing.ts FALLBACK_PRICING. The
// Cloud Function deploys from infra/coordinator/functions/pricing-refresh/
// with only the deps listed in its own package.json — no monorepo TS
// imports. Keep this in sync; quarterly review (#41) is the safety net.
// Units: USD per 1,000,000 tokens.
const FALLBACK_PRICING = {
  "amazon.nova-micro": { in: 0.035, out: 0.14 },
  "amazon.nova-lite": { in: 0.06, out: 0.24 },
  "amazon.nova-pro": { in: 0.8, out: 3.2 },
  "gpt-5-mini": { in: 0.25, out: 2.0 },
  "gpt-5": { in: 1.25, out: 10.0 },
  "gemini-2-5-flash": { in: 0.3, out: 2.5 },
  "gemini-2-5-pro": { in: 1.25, out: 10.0 },
};

class CloudBillingCatalogClient {
  constructor() {
    this.auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-billing.readonly"],
    });
  }

  async request(path, params = {}) {
    const client = await this.auth.getClient();
    const url = new URL(`${CATALOG_BASE_URL}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await client.request({ url: url.toString(), method: "GET" });
    return response.data;
  }

  async findVertexAiServiceName() {
    let pageToken;
    do {
      const body = await this.request("services", { pageSize: 5000, pageToken });
      const service = (body.services ?? []).find((candidate) =>
        /vertex ai/i.test(candidate.displayName ?? ""),
      );
      if (service?.name) return service.name;
      pageToken = body.nextPageToken;
    } while (pageToken);

    throw new Error("Cloud Billing Catalog service for Vertex AI was not found");
  }

  async listSkus(serviceName) {
    const skus = [];
    let pageToken;
    do {
      const body = await this.request(`${serviceName}/skus`, { pageSize: 5000, pageToken });
      skus.push(...(body.skus ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return skus;
  }

  async fetchGcpPricing() {
    const serviceName = await this.findVertexAiServiceName();
    const skus = await this.listSkus(serviceName);
    return parseGcpCatalogPrices(skus);
  }
}

export async function fetchGcpCatalogPrices(catalog = new CloudBillingCatalogClient()) {
  return catalog.fetchGcpPricing();
}

function log(level, msg, extra) {
  // Structured logs play well with Cloud Logging — every entry is one
  // JSON object on stdout, severity included.
  const entry = { severity: level, msg, ts: new Date().toISOString(), ...extra };
  console.log(JSON.stringify(entry));
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function writeOne(firestore, modelId, prices, date) {
  const fetchedAt = new Date().toISOString();
  const snapshot = {
    model_id: modelId,
    price_in_usd_per_mtoken: prices.in,
    price_out_usd_per_mtoken: prices.out,
    effective_date: date,
    source: prices.source || "fallback",
    fetched_at: fetchedAt,
  };
  const modelDoc = firestore.collection("pricing").doc(modelId);

  // Snapshot doc: keyed by date so re-running the same day is idempotent
  // and prior days are never overwritten — this is the "last-known-good"
  // append-only journal that eval replay reads against.
  await modelDoc.collection("snapshots").doc(date).set(snapshot);

  // Latest-pointer doc: cheap single-doc read for the coordinator and
  // bidders. Only the date marker + the two prices, kept as merge so
  // sibling fields a future migration adds aren't clobbered.
  await modelDoc.set(
    {
      model_id: modelId,
      latest_snapshot_date: date,
      latest_price_in_usd_per_mtoken: prices.in,
      latest_price_out_usd_per_mtoken: prices.out,
      updated_at: fetchedAt,
    },
    { merge: true },
  );
}

export const refreshPricing = async (req, res) => {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) {
    log("ERROR", "GCP_PROJECT_ID env var is required");
    res.status(500).send("missing GCP_PROJECT_ID");
    return;
  }

  const date = todayUtc();
  const firestore = new Firestore({ projectId });
  let pricesByModel = { ...FALLBACK_PRICING };

  try {
    const catalogPrices = await fetchGcpCatalogPrices();
    pricesByModel = { ...pricesByModel, ...catalogPrices };
    log("INFO", "pricing-refresh: catalog prices loaded", {
      models: Object.keys(catalogPrices).sort(),
    });
  } catch (err) {
    log("ERROR", "pricing-refresh: catalog fetch failed; using fallback prices", {
      error: err.message,
    });
  }

  const results = { written: [], failed: [] };
  for (const [modelId, prices] of Object.entries(pricesByModel)) {
    try {
      await writeOne(firestore, modelId, prices, date);
      results.written.push(modelId);
    } catch (err) {
      // Per-model isolation: a single bad write doesn't abort the rest.
      // The latest-doc for this model stays on yesterday's values.
      results.failed.push({ model_id: modelId, error: err.message });
      log("ERROR", "pricing-refresh: write failed", {
        model_id: modelId,
        error: err.message,
      });
    }
  }

  if (results.written.length === 0) {
    log("ERROR", "pricing-refresh: nothing written", { date, results });
    // Non-2xx lets Cloud Scheduler's retry config kick in.
    res.status(500).json({ ok: false, date, results });
    return;
  }

  log("INFO", "pricing-refresh: done", {
    date,
    written: results.written.length,
    failed: results.failed.length,
  });
  // 200 even if some models failed — yesterday's prices are still good for
  // those. A repeat at next-scheduled-run picks them up.
  res.status(200).json({ ok: true, date, results });
};

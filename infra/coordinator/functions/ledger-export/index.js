import { BigQuery } from "@google-cloud/bigquery";
import { Firestore } from "@google-cloud/firestore";
import { bidRow, resultRow, taskRow } from "./transform.js";

const DEFAULT_LOOKBACK_HOURS = 24;

function log(level, msg, extra) {
  console.log(JSON.stringify({ severity: level, msg, ts: new Date().toISOString(), ...extra }));
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

function cutoffDate() {
  const hours = Number(process.env.EXPORT_LOOKBACK_HOURS ?? DEFAULT_LOOKBACK_HOURS);
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

async function loadLedgerRows(firestore, cutoff) {
  const tasks = [];
  const bids = [];
  const results = [];
  const query = await firestore
    .collection("tasks")
    .where("updated_at", ">=", cutoff.toISOString())
    .get();

  for (const taskDoc of query.docs) {
    const task = taskDoc.data();
    tasks.push(taskRow(task));

    const [bidSnap, resultSnap] = await Promise.all([
      taskDoc.ref.collection("bids").get(),
      taskDoc.ref.collection("results").get(),
    ]);

    for (const bidDoc of bidSnap.docs) bids.push(bidRow(bidDoc.data()));
    for (const resultDoc of resultSnap.docs) results.push(resultRow(resultDoc.data()));
  }

  return { tasks, bids, results };
}

async function insertRows(dataset, table, rows, insertId) {
  if (rows.length === 0) return 0;
  await dataset.table(table).insert(
    rows.map((row) => ({
      insertId: insertId(row),
      json: row,
    })),
    { raw: true },
  );
  return rows.length;
}

export async function runLedgerExport({
  firestore,
  bigquery,
  datasetId,
  cutoff = cutoffDate(),
} = {}) {
  const db = firestore ?? new Firestore({ projectId: requiredEnv("GCP_PROJECT_ID") });
  const bq = bigquery ?? new BigQuery({ projectId: requiredEnv("GCP_PROJECT_ID") });
  const dataset = bq.dataset(datasetId ?? requiredEnv("BIGQUERY_DATASET"));
  const rows = await loadLedgerRows(db, cutoff);

  const exported = {
    tasks: await insertRows(dataset, "ledger_tasks", rows.tasks, (row) => row.task_id),
    bids: await insertRows(
      dataset,
      "ledger_bids",
      rows.bids,
      (row) => `${row.task_id}:${row.agent_id}:${row.timestamp}`,
    ),
    results: await insertRows(
      dataset,
      "ledger_results",
      rows.results,
      (row) => `${row.task_id}:${row.agent_id}:${row.timestamp}`,
    ),
  };

  log("INFO", "ledger-export: done", { cutoff: cutoff.toISOString(), exported });
  return exported;
}

export const exportLedger = async (_req, res) => {
  try {
    const exported = await runLedgerExport();
    res.status(200).json({ ok: true, exported });
  } catch (err) {
    log("ERROR", "ledger-export: failed", { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
};

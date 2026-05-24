#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  TaskSpecSchema,
  type AgentId,
  type TaskSpec,
  type TaskStatus,
} from "@agent-tasker/protocol";

export interface EvalFixture {
  name: string;
  task: TaskSpec;
}

export interface EvalRunOptions {
  coordinatorUrl: string;
  fixture: EvalFixture;
  runs: number;
  pollIntervalMs: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}

export interface EvalRunResult {
  run: number;
  task_id: string;
  status: TaskStatus;
  winner_agent_id?: AgentId;
  winning_bid_usd?: number;
  auction_price_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  failure_reason?: string;
}

export interface EvalSummary {
  fixture_name: string;
  runs_requested: number;
  completed: number;
  failed: number;
  winners: Partial<Record<AgentId, number>>;
  average_winning_bid_usd: number | null;
  average_auction_price_usd: number | null;
  results: EvalRunResult[];
}

interface CreateTaskResponse {
  task_id: string;
  status_url: string;
}

interface GetTaskResponse {
  task_id: string;
  status: TaskStatus;
  winner_agent_id?: AgentId;
  winning_bid_usd?: number;
  auction_price_usd?: number;
  result?: {
    actual_usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  failure_reason?: string;
}

export async function loadFixture(path: string): Promise<EvalFixture> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  return parseFixture(raw, path);
}

export function parseFixture(raw: unknown, fallbackName = "fixture"): EvalFixture {
  if (!isRecord(raw)) throw new Error("fixture must be a JSON object");
  const taskInput = "task" in raw ? raw["task"] : raw;
  const task = TaskSpecSchema.parse(taskInput);
  const name = raw["name"];
  return {
    name: typeof name === "string" && name.length > 0 ? name : fallbackName,
    task,
  };
}

export async function runEval(options: EvalRunOptions): Promise<EvalSummary> {
  const results: EvalRunResult[] = [];
  for (let i = 1; i <= options.runs; i += 1) {
    results.push(await runOnce(options, i));
  }
  return summarizeResults(options.fixture.name, options.runs, results);
}

export function summarizeResults(
  fixtureName: string,
  runsRequested: number,
  results: EvalRunResult[],
): EvalSummary {
  const completedResults = results.filter((result) => result.status === "completed");
  const failedResults = results.filter((result) => result.status === "failed");
  const winners: Partial<Record<AgentId, number>> = {};
  for (const result of completedResults) {
    if (!result.winner_agent_id) continue;
    winners[result.winner_agent_id] = (winners[result.winner_agent_id] ?? 0) + 1;
  }

  return {
    fixture_name: fixtureName,
    runs_requested: runsRequested,
    completed: completedResults.length,
    failed: failedResults.length,
    winners,
    average_winning_bid_usd: averageDefined(completedResults.map((r) => r.winning_bid_usd)),
    average_auction_price_usd: averageDefined(completedResults.map((r) => r.auction_price_usd)),
    results,
  };
}

async function runOnce(options: EvalRunOptions, run: number): Promise<EvalRunResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const createUrl = new URL("/tasks", normalizeBaseUrl(options.coordinatorUrl));
  const createRes = await fetchImpl(createUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options.fixture.task),
  });
  if (createRes.status !== 202) {
    throw new Error(`POST /tasks failed with ${createRes.status}: ${await createRes.text()}`);
  }

  const created = (await createRes.json()) as CreateTaskResponse;
  const settled = await pollTask({
    fetchImpl,
    statusUrl: created.status_url,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    wait: options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  });

  return {
    run,
    task_id: settled.task_id,
    status: settled.status,
    ...(settled.winner_agent_id ? { winner_agent_id: settled.winner_agent_id } : {}),
    ...(settled.winning_bid_usd !== undefined ? { winning_bid_usd: settled.winning_bid_usd } : {}),
    ...(settled.auction_price_usd !== undefined
      ? { auction_price_usd: settled.auction_price_usd }
      : {}),
    ...(settled.result
      ? {
          input_tokens: settled.result.actual_usage.input_tokens,
          output_tokens: settled.result.actual_usage.output_tokens,
        }
      : {}),
    ...(settled.failure_reason ? { failure_reason: settled.failure_reason } : {}),
  };
}

async function pollTask(args: {
  fetchImpl: typeof fetch;
  statusUrl: string;
  timeoutMs: number;
  pollIntervalMs: number;
  wait: (ms: number) => Promise<void>;
}): Promise<GetTaskResponse> {
  const deadline = Date.now() + args.timeoutMs;
  while (Date.now() <= deadline) {
    const res = await args.fetchImpl(args.statusUrl);
    if (!res.ok) throw new Error(`GET ${args.statusUrl} failed with ${res.status}`);
    const task = (await res.json()) as GetTaskResponse;
    if (task.status === "completed" || task.status === "failed") return task;
    await args.wait(args.pollIntervalMs);
  }
  throw new Error(`timed out waiting for ${args.statusUrl}`);
}

function averageDefined(values: Array<number | undefined>): number | null {
  const defined = values.filter((value): value is number => value !== undefined);
  if (defined.length === 0) return null;
  return defined.reduce((sum, value) => sum + value, 0) / defined.length;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveInt(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const fixture = await loadFixture(args.fixturePath);
  const summary = await runEval({
    coordinatorUrl: args.coordinatorUrl,
    fixture,
    runs: args.runs,
    pollIntervalMs: args.pollIntervalMs,
    timeoutMs: args.timeoutMs,
  });
  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(argv: string[]): {
  coordinatorUrl: string;
  fixturePath: string;
  runs: number;
  pollIntervalMs: number;
  timeoutMs: number;
} {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) throw new Error(`unexpected argument ${arg}`);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
    values.set(arg.slice(2), value);
    i += 1;
  }

  const coordinatorUrl = values.get("coordinator-url");
  const fixturePath = values.get("fixture");
  if (!coordinatorUrl) throw new Error("--coordinator-url is required");
  if (!fixturePath) throw new Error("--fixture is required");

  return {
    coordinatorUrl,
    fixturePath,
    runs: parsePositiveInt(values.get("runs") ?? "1", "--runs"),
    pollIntervalMs: parsePositiveInt(
      values.get("poll-interval-ms") ?? "1000",
      "--poll-interval-ms",
    ),
    timeoutMs: parsePositiveInt(values.get("timeout-ms") ?? "120000", "--timeout-ms"),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

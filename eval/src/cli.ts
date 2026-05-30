#!/usr/bin/env node
/**
 * Interactive task submission CLI.
 *
 * Usage:
 *   agent-tasker-submit --coordinator-url http://localhost:8080 --prompt "Summarize X"
 *   agent-tasker-submit --coordinator-url http://localhost:8080 --prompt "..." --min-tier frontier
 *   agent-tasker-submit --coordinator-url http://localhost:8080 --prompt "..." --runs 3
 *
 * Unlike the eval harness (which takes a fixture file and outputs JSON), this
 * CLI is meant for interactive dev testing — it shows live phase transitions
 * and prints the output in human-readable form.
 */
import { pathToFileURL } from "node:url";
import type { TaskStatus, AgentId } from "@agent-tasker/protocol";

interface CliArgs {
  coordinatorUrl: string;
  prompt: string;
  minTier: "small" | "medium" | "frontier" | undefined;
  runs: number;
  pollIntervalMs: number;
  timeoutMs: number;
}

interface TaskCreatedResponse {
  task_id: string;
  status_url: string;
}

interface TaskStateResponse {
  task_id: string;
  status: TaskStatus;
  winner_agent_id?: AgentId;
  winning_bid_usd?: number;
  auction_price_usd?: number;
  failure_reason?: string;
  result?: {
    output: string;
    actual_usage: { input_tokens: number; output_tokens: number };
  };
}

function fmt(n: number, decimals = 4): string {
  return `$${n.toFixed(decimals)}`;
}

async function submitAndWatch(args: CliArgs, run: number): Promise<void> {
  const label = args.runs > 1 ? ` [run ${run}/${args.runs}]` : "";

  const createUrl = new URL(
    "/tasks",
    args.coordinatorUrl.endsWith("/") ? args.coordinatorUrl : `${args.coordinatorUrl}/`,
  );

  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: args.prompt,
      ...(args.minTier ? { min_tier: args.minTier } : {}),
    }),
  });

  if (createRes.status !== 202) {
    const text = await createRes.text();
    throw new Error(`POST /tasks failed with ${createRes.status}: ${text}`);
  }

  const created = (await createRes.json()) as TaskCreatedResponse;
  console.log(`\nSubmitted${label}: ${created.task_id}`);

  let lastStatus: TaskStatus | null = null;
  const deadline = Date.now() + args.timeoutMs;

  while (Date.now() <= deadline) {
    const res = await fetch(created.status_url);
    if (!res.ok) throw new Error(`GET ${created.status_url} returned ${res.status}`);
    const task = (await res.json()) as TaskStateResponse;

    if (task.status !== lastStatus) {
      lastStatus = task.status;
      const statusLine = formatStatus(task);
      process.stdout.write(`  ${statusLine}\n`);
    }

    if (task.status === "completed" || task.status === "failed") {
      printResult(task);
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, args.pollIntervalMs));
  }

  throw new Error(`Timed out after ${args.timeoutMs}ms waiting for ${created.task_id}`);
}

function formatStatus(task: TaskStateResponse): string {
  switch (task.status) {
    case "bidding":
      return "bidding...";
    case "awarded":
      return task.winner_agent_id && task.winning_bid_usd !== undefined
        ? `awarded → ${task.winner_agent_id} (bid ${fmt(task.winning_bid_usd)})`
        : "awarded";
    case "executing":
      return "executing...";
    case "completed":
      return "completed";
    case "failed":
      return `failed${task.failure_reason ? `: ${task.failure_reason}` : ""}`;
  }
}

function printResult(task: TaskStateResponse): void {
  if (task.status === "failed") {
    console.log(`\n  Failed: ${task.failure_reason ?? "unknown reason"}`);
    return;
  }

  console.log();
  console.log(`  Winner:        ${task.winner_agent_id ?? "-"}`);
  if (task.winning_bid_usd !== undefined)
    console.log(`  Winning bid:   ${fmt(task.winning_bid_usd)}`);
  if (task.auction_price_usd !== undefined)
    console.log(`  Auction price: ${fmt(task.auction_price_usd)}`);
  if (task.result?.actual_usage) {
    const { input_tokens, output_tokens } = task.result.actual_usage;
    console.log(
      `  Tokens:        ${input_tokens.toLocaleString()} in / ${output_tokens.toLocaleString()} out`,
    );
  }

  if (task.result?.output) {
    console.log("\n  Output:");
    console.log("  " + "-".repeat(60));
    for (const line of task.result.output.split("\n")) {
      console.log(`  ${line}`);
    }
    console.log("  " + "-".repeat(60));
  }
}

function parseArgs(argv: string[]): CliArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
    values.set(arg.slice(2), value);
    i++;
  }

  const coordinatorUrl = values.get("coordinator-url");
  const prompt = values.get("prompt");
  if (!coordinatorUrl) throw new Error("--coordinator-url is required");
  if (!prompt) throw new Error("--prompt is required");

  const minTierRaw = values.get("min-tier");
  const minTier =
    minTierRaw === "small" || minTierRaw === "medium" || minTierRaw === "frontier"
      ? minTierRaw
      : minTierRaw !== undefined
        ? (() => {
            throw new Error(`--min-tier must be small, medium, or frontier`);
          })()
        : undefined;

  const runs = parseInt(values.get("runs") ?? "1", 10);
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");

  return {
    coordinatorUrl,
    prompt,
    minTier,
    runs,
    pollIntervalMs: parseInt(values.get("poll-interval-ms") ?? "1000", 10),
    timeoutMs: parseInt(values.get("timeout-ms") ?? "120000", 10),
  };
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  for (let i = 1; i <= args.runs; i++) {
    await submitAndWatch(args, i);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

const TERMINAL_STATUSES = new Set(["completed", "failed"]);
const STORAGE_KEYS = {
  apiBase: "agent-tasker.console.apiBase",
  history: "agent-tasker.console.history",
};

const els = {
  apiForm: document.querySelector("#api-form"),
  apiBase: document.querySelector("#api-base"),
  apiLabel: document.querySelector("#api-label"),
  taskForm: document.querySelector("#task-form"),
  prompt: document.querySelector("#prompt"),
  minTier: document.querySelector("#min-tier"),
  callbackUrl: document.querySelector("#callback-url"),
  loadExample: document.querySelector("#load-example"),
  stopPolling: document.querySelector("#stop-polling"),
  lookupForm: document.querySelector("#lookup-form"),
  lookupId: document.querySelector("#lookup-id"),
  taskLabel: document.querySelector("#task-label"),
  pollLabel: document.querySelector("#poll-label"),
  statusValue: document.querySelector("#status-value"),
  winnerValue: document.querySelector("#winner-value"),
  auctionValue: document.querySelector("#auction-value"),
  usageValue: document.querySelector("#usage-value"),
  outputValue: document.querySelector("#output-value"),
  stepTrace: document.querySelector("#step-trace"),
  historyBody: document.querySelector("#history-body"),
  clearHistory: document.querySelector("#clear-history"),
};

let currentTaskId = "";
let pollTimer = null;
let history = readHistory();

init();

function init() {
  const savedApiBase = localStorage.getItem(STORAGE_KEYS.apiBase) || "http://localhost:8080";
  els.apiBase.value = savedApiBase;
  setApiLabel(savedApiBase);
  renderHistory();

  els.apiForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = normalizeApiBase(els.apiBase.value);
    localStorage.setItem(STORAGE_KEYS.apiBase, value);
    els.apiBase.value = value;
    setApiLabel(value);
  });

  els.loadExample.addEventListener("click", () => {
    els.prompt.value =
      "Summarize the tradeoffs of using a direct single-call Gemini agent versus a GAEP orchestrator for a multi-step research task. Include cost, latency, and failure-mode considerations.";
    els.minTier.value = "medium";
  });

  els.taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitTask();
  });

  els.lookupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = els.lookupId.value.trim();
    if (!id) return;
    await loadTask(id, { startPolling: true });
  });

  els.stopPolling.addEventListener("click", stopPolling);
  els.clearHistory.addEventListener("click", () => {
    history = [];
    writeHistory();
    renderHistory();
  });
}

async function submitTask() {
  const prompt = els.prompt.value.trim();
  if (!prompt) return;

  const task = { prompt };
  if (els.minTier.value) task.min_tier = els.minTier.value;
  if (els.callbackUrl.value.trim()) task.callback_url = els.callbackUrl.value.trim();

  setPollLabel("Submitting");
  const response = await request("/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(task),
  });
  currentTaskId = response.task_id;
  els.lookupId.value = currentTaskId;
  upsertHistory({
    task_id: currentTaskId,
    status: "bidding",
    updated_at: new Date().toISOString(),
  });
  await loadTask(currentTaskId, { startPolling: true });
}

async function loadTask(taskId, options = {}) {
  currentTaskId = taskId;
  els.taskLabel.textContent = taskId;
  try {
    const task = await request(`/tasks/${encodeURIComponent(taskId)}`);
    renderTask(task);
    upsertHistory(task);
    if (options.startPolling && !TERMINAL_STATUSES.has(task.status)) startPolling(taskId);
    if (TERMINAL_STATUSES.has(task.status)) stopPolling();
  } catch (error) {
    renderError(error);
    stopPolling();
  }
}

function startPolling(taskId) {
  stopPolling();
  setPollLabel("Every 2s");
  pollTimer = window.setInterval(() => {
    void loadTask(taskId);
  }, 2000);
}

function stopPolling() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = null;
  setPollLabel("Idle");
}

async function request(path, init) {
  const apiBase = normalizeApiBase(els.apiBase.value);
  const res = await fetch(`${apiBase}${path}`, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = body?.error?.message || `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return body;
}

function renderTask(task) {
  els.statusValue.textContent = task.status;
  els.statusValue.className = `status-${task.status}`;
  els.winnerValue.textContent = task.winner_agent_id || "-";
  els.auctionValue.textContent = money(task.auction_price_usd);
  els.usageValue.textContent = usage(task.result?.actual_usage);
  els.outputValue.textContent = task.failure_reason || task.result?.output || "No output yet.";
  renderStepTrace(task.result?.step_trace);
}

function renderStepTrace(stepTrace) {
  if (!stepTrace) {
    els.stepTrace.textContent = "No step trace.";
    return;
  }

  els.stepTrace.innerHTML = "";
  const summary = document.createElement("p");
  summary.textContent = `${stepTrace.total_steps} steps, ${stepTrace.tool_call_count} tool calls`;
  els.stepTrace.append(summary);

  for (const step of stepTrace.steps || []) {
    const item = document.createElement("div");
    item.className = "step";

    const title = document.createElement("div");
    title.className = "step-title";
    title.innerHTML = `<span>#${step.index} ${escapeHtml(step.description || "Step")}</span><span>${escapeHtml(step.state || "")}</span>`;
    item.append(title);

    const actions = document.createElement("div");
    actions.className = "step-actions";
    actions.textContent =
      step.actions
        ?.map((action) => `${action.tool}${action.query ? `: ${action.query}` : ""}`)
        .join(" | ") || "No actions";
    item.append(actions);

    els.stepTrace.append(item);
  }
}

function renderError(error) {
  els.statusValue.textContent = "Error";
  els.statusValue.className = "status-failed";
  els.outputValue.textContent = error.message;
}

function renderHistory() {
  if (history.length === 0) {
    els.historyBody.innerHTML = '<tr><td colspan="4">No recent tasks.</td></tr>';
    return;
  }

  els.historyBody.innerHTML = "";
  for (const task of history) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><button class="ghost" type="button" data-task-id="${escapeHtml(task.task_id)}">${escapeHtml(task.task_id)}</button></td>
      <td class="status-${escapeHtml(task.status || "")}">${escapeHtml(task.status || "-")}</td>
      <td>${escapeHtml(task.winner_agent_id || "-")}</td>
      <td>${formatDate(task.updated_at)}</td>
    `;
    row.querySelector("button").addEventListener("click", () => {
      els.lookupId.value = task.task_id;
      void loadTask(task.task_id, { startPolling: true });
    });
    els.historyBody.append(row);
  }
}

function upsertHistory(task) {
  const next = {
    task_id: task.task_id,
    status: task.status,
    winner_agent_id: task.winner_agent_id,
    updated_at: task.updated_at || new Date().toISOString(),
  };
  history = [next, ...history.filter((item) => item.task_id !== task.task_id)].slice(0, 12);
  writeHistory();
  renderHistory();
}

function readHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.history) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeHistory() {
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
}

function normalizeApiBase(value) {
  return (value || "http://localhost:8080").trim().replace(/\/+$/, "");
}

function setApiLabel(value) {
  els.apiLabel.textContent = normalizeApiBase(value);
}

function setPollLabel(value) {
  els.pollLabel.textContent = value;
}

function money(value) {
  return typeof value === "number" ? `$${value.toFixed(6)}` : "-";
}

function usage(actualUsage) {
  if (!actualUsage) return "-";
  return `${actualUsage.input_tokens} in / ${actualUsage.output_tokens} out`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

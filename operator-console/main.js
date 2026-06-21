/*
 * Agent Tasker — Market Terminal
 *
 * Faithful recreation of the Claude Design handoff ("Agent Tasker Terminal.dc.html")
 * in vanilla JS. The handoff's custom <sc-if>/<sc-for>/{{ }} template runtime is NOT
 * ported; the markup, design tokens, timings, and sample economics are reproduced 1:1.
 *
 * Data is mock/sample (as in the handoff) and illustrates layout + Vickrey economics.
 * Real coordinator wiring (POST /tasks, polling, Firestore pricing/ledger) is a
 * documented follow-up — see the repo CLAUDE.md "Client-facing API" + the handoff
 * "State Management" section. The Settings screen already captures the API base URL
 * and poll interval that wiring will consume.
 */

// ---------------------------------------------------------------------------
// Data (mock/sample — mirrors the handoff)
// ---------------------------------------------------------------------------

const COLORS = { gcp: "#4285f4", orch: "#34a853", aws: "#ff9900", azure: "#2ec5ce" };
const INITIALS = { gcp: "G", orch: "O", aws: "N", azure: "P" };

const AGENTS = [
  // prettier-ignore
  { id: "gcp", cloud: "GCP", name: "Gemini", runtime: "direct · vertex", model: "Gemini 2.5 Pro", note: "", tier: "frontier", specialty: "simple-task specialist", win: 41, mape: 12.4, avg: 0.018, region: "us-central1", p50: 1.9, p95: 3.4, cold: "0.4%", deploy: "live", tasks7d: 312, trend: [28, 33, 30, 38, 36, 41, 39, 41] },
  // prettier-ignore
  { id: "orch", cloud: "GCP", name: "Orchestrator", runtime: "GAEP · multi-step", model: "Gemini 2.5 Pro + tools", note: "", tier: "frontier", specialty: "complex-task specialist", win: 11, mape: 23.7, avg: 0.114, region: "us-central1", p50: 6.2, p95: 11.8, cold: "1.1%", deploy: "live", tasks7d: 84, trend: [14, 12, 15, 10, 13, 11, 12, 11] },
  // prettier-ignore
  { id: "aws", cloud: "AWS", name: "Nova", runtime: "bedrock · lambda", model: "Amazon Nova Pro", note: "", tier: "frontier", specialty: "low-cost leader", win: 27, mape: 9.8, avg: 0.006, region: "us-east-1", p50: 1.4, p95: 2.8, cold: "2.3%", deploy: "staged", tasks7d: 207, trend: [19, 22, 24, 21, 25, 27, 26, 27] },
  // prettier-ignore
  { id: "azure", cloud: "AZURE", name: "GPT", runtime: "openai · container", model: "gpt-4o", note: "GPT-5 quota pending", tier: "frontier", specialty: "balanced generalist", win: 21, mape: 15.1, avg: 0.041, region: "eastus2", p50: 3.0, p95: 5.6, cold: "1.8%", deploy: "staged", tasks7d: 164, trend: [24, 22, 20, 23, 19, 21, 20, 21] },
];

const TASKS = [
  // prettier-ignore
  { id: "tk_4821", prompt: "Extract all line items, dates, and amounts from this 3-page invoice", status: "completed", tier: "small ok", winner: "aws", price: 0.016, latency: "3.0s", steps: "single call", out: "12 fields", ts: "just now", bids: { gcp: 0.016, orch: 0.092, aws: 0.006, azure: 0.041 }, usage: "2,140 in / 380 out" },
  // prettier-ignore
  { id: "tk_4820", prompt: "Summarize this 1,800-word support transcript into 5 bullets", status: "completed", tier: "frontier", winner: "orch", price: 0.071, latency: "9.4s", steps: "3 tool steps", out: "completed", ts: "38s ago", bids: { gcp: 0.071, orch: 0.052, aws: 0.13, azure: 0.088 }, usage: "4,820 in / 410 out", trace: true },
  // prettier-ignore
  { id: "tk_4819", prompt: 'Translate "quarterly earnings call" to Japanese', status: "completed", tier: "small ok", winner: "aws", price: 0.014, latency: "2.1s", steps: "single call", out: "四半期決算説明会", ts: "1m ago", bids: { gcp: 0.014, orch: 0.121, aws: 0.005, azure: 0.038 }, usage: "310 in / 24 out" },
  // prettier-ignore
  { id: "tk_4818", prompt: "Draft a polite follow-up email declining a vendor", status: "completed", tier: "frontier", winner: "azure", price: 0.034, latency: "4.2s", steps: "single call", out: "completed", ts: "2m ago", bids: { gcp: 0.034, orch: 0.081, aws: 0.047, azure: 0.021 }, usage: "640 in / 290 out" },
  // prettier-ignore
  { id: "tk_4817", prompt: "Classify 200 reviews as positive / negative / neutral", status: "completed", tier: "—", winner: "aws", price: 0.022, latency: "5.8s", steps: "single call", out: "200 labels", ts: "3m ago", bids: { gcp: 0.022, orch: 0.099, aws: 0.007, azure: 0.046 }, usage: "8,200 in / 600 out" },
  // prettier-ignore
  { id: "tk_4816", prompt: "Build a 3-step research plan on EU AI Act compliance", status: "completed", tier: "frontier", winner: "orch", price: 0.09, latency: "14.2s", steps: "5 tool steps", out: "completed", ts: "5m ago", bids: { gcp: 0.09, orch: 0.061, aws: 0.15, azure: 0.12 }, usage: "11,400 in / 1,820 out", trace: true },
  // prettier-ignore
  { id: "tk_4815", prompt: "Rewrite this paragraph at a 6th-grade reading level", status: "completed", tier: "—", winner: "aws", price: 0.012, latency: "1.6s", steps: "single call", out: "completed", ts: "6m ago", bids: { gcp: 0.012, orch: 0.071, aws: 0.004, azure: 0.031 }, usage: "280 in / 190 out" },
  // prettier-ignore
  { id: "tk_4814", prompt: 'Generate SQL for "top 10 customers by Q3 revenue"', status: "completed", tier: "small ok", winner: "gcp", price: 0.021, latency: "2.4s", steps: "single call", out: "1 query", ts: "8m ago", bids: { gcp: 0.013, orch: 0.077, aws: 0.021, azure: 0.035 }, usage: "420 in / 140 out" },
  // prettier-ignore
  { id: "tk_4813", prompt: "Extract entities + sentiment from 50 tweets", status: "failed", tier: "—", winner: "azure", price: 0.033, latency: "—", steps: "timeout", out: "agent timeout 30s", ts: "11m ago", bids: { gcp: 0.033, orch: 0.084, aws: 0.049, azure: 0.024 }, usage: "—" },
  // prettier-ignore
  { id: "tk_4812", prompt: "Write unit tests for this 40-line Python function", status: "completed", tier: "frontier", winner: "gcp", price: 0.026, latency: "4.9s", steps: "single call", out: "completed", ts: "13m ago", bids: { gcp: 0.017, orch: 0.083, aws: 0.026, azure: 0.049 }, usage: "1,210 in / 880 out" },
  // prettier-ignore
  { id: "tk_4811", prompt: "Plan + draft a 6-email onboarding sequence", status: "completed", tier: "frontier", winner: "orch", price: 0.082, latency: "12.8s", steps: "4 tool steps", out: "completed", ts: "16m ago", bids: { gcp: 0.082, orch: 0.058, aws: 0.14, azure: 0.11 }, usage: "6,900 in / 2,400 out", trace: true },
  // prettier-ignore
  { id: "tk_4810", prompt: "Summarize a 12-page PDF contract into key risks", status: "completed", tier: "frontier", winner: "azure", price: 0.045, latency: "6.1s", steps: "single call", out: "8 risks", ts: "19m ago", bids: { gcp: 0.045, orch: 0.087, aws: 0.058, azure: 0.029 }, usage: "9,800 in / 720 out" },
];

const KPIS_BY_RANGE = {
  live: [
    { lab: "Settled · last hour", val: "12", delta: "▲ live", color: "var(--win)" },
    { lab: "Spend · last hour", val: "$0.34", delta: "execute only", color: "var(--inkDim)" },
    { lab: "Avg / task", val: "$0.0283", delta: "this hour", color: "var(--inkDim)" },
    { lab: "Avg settle", val: "6.9s", delta: "bid + exec", color: "var(--inkDim)" },
    { lab: "Decline rate", val: "2.4%", delta: "capability / policy", color: "var(--inkDim)" },
  ],
  "24h": [
    { lab: "Tasks settled", val: "38", delta: "▲ 38 today", color: "var(--win)" },
    { lab: "Total spend", val: "$1.06", delta: "execute only", color: "var(--inkDim)" },
    { lab: "Avg / task", val: "$0.0279", delta: "▼ 6% vs 7d", color: "var(--win)" },
    { lab: "Avg settle", val: "7.4s", delta: "bid + exec", color: "var(--inkDim)" },
    { lab: "Decline rate", val: "2.9%", delta: "capability / policy", color: "var(--inkDim)" },
  ],
  "7d": [
    { lab: "Tasks settled", val: "412", delta: "▲ 412 this week", color: "var(--win)" },
    { lab: "Total spend", val: "$11.80", delta: "execute only", color: "var(--inkDim)" },
    { lab: "Avg / task", val: "$0.0286", delta: "steady", color: "var(--inkDim)" },
    { lab: "Avg settle", val: "7.0s", delta: "bid + exec", color: "var(--inkDim)" },
    { lab: "Decline rate", val: "3.4%", delta: "capability / policy", color: "var(--inkDim)" },
  ],
  all: [
    { lab: "Tasks settled", val: "767", delta: "since launch", color: "var(--inkDim)" },
    { lab: "Total spend", val: "$21.40", delta: "execute only", color: "var(--inkDim)" },
    { lab: "Avg / task", val: "$0.0279", delta: "lifetime", color: "var(--inkDim)" },
    { lab: "Avg settle", val: "7.1s", delta: "bid + exec", color: "var(--inkDim)" },
    { lab: "Decline rate", val: "3.2%", delta: "capability / policy", color: "var(--inkDim)" },
  ],
};

const PRICING = [
  { id: "gcp", model: "Gemini 2.5 Pro", tier: "frontier", inP: 1.25, outP: 10.0, ctx: "2M" },
  {
    id: "orch",
    model: "Gemini 2.5 Pro + tools",
    tier: "frontier",
    inP: 1.25,
    outP: 10.0,
    ctx: "2M",
  },
  { id: "aws", model: "Amazon Nova Pro", tier: "frontier", inP: 0.8, outP: 3.2, ctx: "300K" },
  { id: "azure", model: "gpt-4o", tier: "frontier", inP: 2.5, outP: 10.0, ctx: "128K" },
];

const PHASES = [
  // prettier-ignore
  { n: "Phase 1", t: "GCP — Gemini + Orchestrator", state: "Deployed", color: "var(--win)", detail: "Cloud Run · Firestore ledger · JWKS · daily pricing refresh" },
  // prettier-ignore
  { n: "Phase 2", t: "AWS — Nova", state: "In-tree · gated", color: "var(--warn)", detail: "Terraform + CI present · gated on AWS_ROLE_ARN" },
  // prettier-ignore
  { n: "Phase 3", t: "Azure — GPT", state: "In-tree · gated", color: "var(--warn)", detail: "Terraform + CI present · gated on AZURE_CLIENT_ID" },
];

const STEP_TRACES = {
  tk_4820: [
    { i: 1, d: "Read transcript & detect language", state: "done", actions: "load_document" },
    {
      i: 2,
      d: "Extract key complaint threads",
      state: "done",
      actions: 'search: "billing issue" | search: "refund"',
    },
    { i: 3, d: "Compose 5-bullet summary", state: "done", actions: "synthesize" },
  ],
  tk_4816: [
    {
      i: 1,
      d: "Scope EU AI Act obligations",
      state: "done",
      actions: 'web_search: "EU AI Act high-risk"',
    },
    { i: 2, d: "Map obligations to product", state: "done", actions: "retrieve: policy_docs" },
    { i: 3, d: "Draft compliance checklist", state: "done", actions: "synthesize" },
    { i: 4, d: "Identify gaps & owners", state: "done", actions: "reason" },
    { i: 5, d: "Assemble 3-step plan", state: "done", actions: "compose" },
  ],
  tk_4811: [
    { i: 1, d: "Define onboarding journey stages", state: "done", actions: "reason" },
    { i: 2, d: "Draft 6 email outlines", state: "done", actions: "compose" },
    { i: 3, d: "Write full copy per email", state: "done", actions: "compose x6" },
    { i: 4, d: "QA tone & CTA consistency", state: "done", actions: "critique" },
  ],
};

const TITLES = {
  dashboard: ["Market Dashboard", "Live overview · 4 agents · 3 clouds"],
  live: ["Live Auction", "Sealed-bid Vickrey auction in real time"],
  ledger: ["Ledger", "Every settled task"],
  agents: ["Agents", "Four model-locked bidders"],
  agentDetail: ["Agent", "Performance & health"],
  submit: ["Submit Task", "Post a task to the market"],
  taskDetail: ["Task", "Auction & execution detail"],
  pricing: ["Pricing", "Per-model token prices · daily refresh"],
  health: ["System Health", "Coordinator, agents & deploy status"],
  settings: ["Settings", "Coordinator connection & auth"],
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  screen: "dashboard",
  range: "live",
  agentId: "gcp",
  taskId: "tk_4821",
  livePhase: "idle", // idle | countdown | revealing | awarded | executing | completed
  liveCount: 3,
  liveRevealed: 0,
  liveTask: null,
  execProgress: 0,
  form: { prompt: "", minTier: "", callback: "" },
  submitState: "idle",
  fStatus: "all",
  fWinner: "all",
  query: "",
  settings: { apiBase: "https://coordinator-agent-tasker-lcd.a.run.app", poll: "2", auth: "oidc" },
  intro: true,
  toast: null,
  formError: "",
};

let cdTimer = null;
let revealTimer = null;
let execTimer = null;
let toastTimer = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agentById(id) {
  return AGENTS.find((a) => a.id === id);
}
function taskById(id) {
  return TASKS.find((t) => t.id === id);
}
function money(v) {
  return "$" + v.toFixed(3);
}
function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

function navStyle(active) {
  const base =
    "display:flex;align-items:center;gap:11px;width:100%;padding:9px 12px;margin-bottom:2px;border:0;border-radius:9px;font:inherit;font-size:13px;cursor:pointer;text-align:left;letter-spacing:.2px;transition:background .12s;";
  return (
    base +
    (active
      ? "background:rgba(110,139,255,.14);color:var(--ink);box-shadow:inset 0 0 0 1px rgba(110,139,255,.28);font-weight:550;"
      : "background:transparent;color:var(--inkDim);")
  );
}
function rangeStyle(active) {
  return (
    "background:" +
    (active ? "var(--panel2)" : "none") +
    ";border:0;color:" +
    (active ? "var(--ink)" : "var(--inkDim)") +
    ";font:inherit;font-size:12px;padding:6px 12px;border-radius:7px;cursor:pointer;" +
    (active ? "box-shadow:inset 0 0 0 1px var(--line);" : "")
  );
}
function fStyle(active) {
  return (
    "background:" +
    (active ? "var(--panel2)" : "transparent") +
    ";border:1px solid " +
    (active ? "var(--brand)" : "var(--line)") +
    ";color:" +
    (active ? "var(--ink)" : "var(--inkDim)") +
    ";font:inherit;font-size:11.5px;padding:6px 11px;border-radius:7px;cursor:pointer;letter-spacing:.2px;"
  );
}

function avatarStyle(c, size) {
  const dims = {
    36: "width:36px;height:36px;border-radius:10px;font-size:15px;",
    30: "width:30px;height:30px;border-radius:8px;font-size:13px;",
  }[size];
  return (
    dims +
    `flex:none;display:flex;align-items:center;justify-content:center;font-weight:700;background:color-mix(in srgb, ${c} 18%, transparent);color:${c};border:1px solid color-mix(in srgb, ${c} 34%, transparent);`
  );
}

function agentDisplay(a) {
  const c = COLORS[a.id];
  return {
    ...a,
    color: c,
    initial: INITIALS[a.id] || a.name[0],
    avatarStyle: avatarStyle(c, 36),
    tint: `color-mix(in srgb, ${c} 16%, transparent)`,
    tintLine: `color-mix(in srgb, ${c} 35%, transparent)`,
    winPct: a.win + "%",
    mape: a.mape + "%",
    avg: "$" + a.avg.toFixed(3),
    modelLine: a.model + " · frontier · " + a.specialty,
    winBar: `display:block;height:100%;width:${a.win}%;background:${c};border-radius:3px;`,
    spark: sparkPoints(a.trend, 96, 30),
    sparkBig: sparkPoints(a.trend, 520, 120),
    deployLabel: a.deploy === "live" ? "Deployed" : "Staged (gated)",
    deployColor: a.deploy === "live" ? "var(--win)" : "var(--warn)",
  };
}

function bidBars(task) {
  const order = ["gcp", "orch", "aws", "azure"];
  const vals = order.map((k) => task.bids[k]);
  const max = Math.max(...vals);
  return order.map((k) => {
    const c = COLORS[k];
    const v = task.bids[k];
    const isWin = k === task.winner;
    const h = Math.round((v / max) * 100);
    const base = `width:34px;border-radius:4px 4px 0 0;position:relative;height:${Math.max(h, 14)}%;background:color-mix(in srgb, ${c} 38%, var(--panel2));`;
    const winS = isWin
      ? `opacity:1;box-shadow:0 0 0 1px ${c},0 0 14px color-mix(in srgb, ${c} 50%, transparent);background:color-mix(in srgb, ${c} 55%, var(--panel2));`
      : "opacity:.5;";
    return { color: c, cap: "$" + v.toFixed(3).slice(1), barStyle: base + winS, isWin };
  });
}

function sparkPoints(trend, w, h) {
  const max = Math.max(...trend);
  const min = Math.min(...trend);
  const span = max - min || 1;
  return trend
    .map((v, i) => {
      const x = (i / (trend.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return x.toFixed(1) + "," + y.toFixed(1);
    })
    .join(" ");
}

function stepTrace(task) {
  if (!task.trace) return null;
  return (
    STEP_TRACES[task.id] || [{ i: 1, d: "Single model call", state: "done", actions: "complete" }]
  );
}

function recentForAgent(id) {
  return TASKS.filter((t) => t.winner === id).slice(0, 5);
}

function filteredTasks() {
  let list = TASKS.slice();
  if (state.fStatus !== "all") list = list.filter((t) => t.status === state.fStatus);
  if (state.fWinner !== "all") list = list.filter((t) => t.winner === state.fWinner);
  if (state.query.trim()) {
    const q = state.query.toLowerCase();
    list = list.filter((t) => t.prompt.toLowerCase().includes(q) || t.id.includes(q));
  }
  return list;
}

// ---------------------------------------------------------------------------
// Live auction sample-data generation
// ---------------------------------------------------------------------------

function defaultLiveTask() {
  return {
    prompt: "Extract all line items, dates, and amounts from this 3-page invoice",
    minTier: "small",
    bids: { gcp: 0.016, orch: 0.092, aws: 0.006, azure: 0.041 },
    winner: "aws",
    price: 0.016,
    out: "12 fields extracted · JSON",
    latency: "3.0s",
    steps: "single call",
  };
}

function genAuction(prompt, minTier) {
  const j = () => 0.85 + Math.random() * 0.4;
  const bids = {
    gcp: +(agentById("gcp").avg * j()).toFixed(3),
    orch: +(agentById("orch").avg * j()).toFixed(3),
    aws: +(agentById("aws").avg * j()).toFixed(3),
    azure: +(agentById("azure").avg * j()).toFixed(3),
  };
  const order = ["gcp", "orch", "aws", "azure"];
  const sorted = order.slice().sort((a, b) => bids[a] - bids[b]);
  const winner = sorted[0];
  const second = bids[sorted[1]];
  return {
    prompt,
    minTier,
    bids,
    winner,
    price: +second.toFixed(3),
    out: "completed",
    latency: (2 + Math.random() * 6).toFixed(1) + "s",
    steps: minTier === "frontier" ? "multi-step" : "single call",
  };
}

// ---------------------------------------------------------------------------
// Live auction timeline (timer-driven)
// ---------------------------------------------------------------------------

function clearTimers() {
  clearInterval(cdTimer);
  clearInterval(revealTimer);
  clearInterval(execTimer);
}

function startAuction(task) {
  clearTimers();
  const t = task || state.liveTask || defaultLiveTask();
  setState({
    screen: "live",
    liveTask: t,
    livePhase: "countdown",
    liveCount: 3,
    liveRevealed: 0,
    execProgress: 0,
  });
  cdTimer = setInterval(() => {
    if (state.liveCount <= 1) {
      clearInterval(cdTimer);
      setState({ liveCount: 0, livePhase: "revealing" });
      revealLoop();
    } else {
      setState({ liveCount: state.liveCount - 1 });
    }
  }, 850);
}

function revealLoop() {
  revealTimer = setInterval(() => {
    if (state.liveRevealed >= 4) {
      clearInterval(revealTimer);
      setState({ liveRevealed: 4 });
      awardLoop();
    } else {
      setState({ liveRevealed: state.liveRevealed + 1 });
    }
  }, 620);
}

function awardLoop() {
  setTimeout(() => {
    setState({ livePhase: "awarded" });
    setTimeout(() => {
      setState({ livePhase: "executing", execProgress: 0 });
      execTimer = setInterval(() => {
        if (state.execProgress >= 100) {
          clearInterval(execTimer);
          setState({ livePhase: "completed", execProgress: 100 });
        } else {
          setState({ execProgress: Math.min(100, state.execProgress + 7) });
        }
      }, 130);
    }, 1100);
  }, 700);
}

function showToast(msg) {
  setState({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 2800);
}

function dismissIntro() {
  try {
    localStorage.setItem("at_intro_dismissed", "1");
  } catch {
    /* storage unavailable */
  }
  setState({ intro: false });
}

// ---------------------------------------------------------------------------
// Shell (built once)
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  {
    group: "Market",
    items: [
      {
        key: "dashboard",
        label: "Dashboard",
        icon: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
      },
      { key: "live", label: "Live Auction", icon: '<path d="M3 12h4l3 8 4-16 3 8h4"/>', dot: true },
      { key: "ledger", label: "Ledger", icon: '<path d="M4 6h16M4 12h16M4 18h16"/>' },
    ],
  },
  {
    group: "Agents",
    items: [
      {
        key: "agents",
        label: "Agents",
        icon: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 6a3 3 0 0 1 0 6M21 20a5 5 0 0 0-4-5"/>',
      },
    ],
  },
  {
    group: "Operate",
    items: [
      { key: "submit", label: "Submit Task", icon: '<path d="M5 12h14M13 6l6 6-6 6"/>' },
      {
        key: "pricing",
        label: "Pricing",
        icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5a2.5 2 0 0 1 5 0c0 1.5-5 1-5 3a2.5 2 0 0 0 5 0"/>',
      },
    ],
  },
  {
    group: "System",
    items: [
      { key: "health", label: "Health", icon: '<path d="M3 12h4l2-5 4 14 2-7h6"/>' },
      {
        key: "settings",
        label: "Settings",
        icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.2A1.7 1.7 0 0 0 6 19.5l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 13H3a2 2 0 0 1 0-4h.2A1.7 1.7 0 0 0 4.5 6"/>',
      },
    ],
  },
];

function navButtonHtml(item) {
  const labelCap = item.key.charAt(0).toUpperCase() + item.key.slice(1);
  const dot = item.dot
    ? '<span style="margin-left:auto;width:7px;height:7px;border-radius:50%;background:var(--win);animation:at_pulse 1.6s infinite;"></span>'
    : "";
  return `<button id="nav-${item.key}" data-action="go:${item.key}" style="${navStyle(false)}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${item.icon}</svg>${esc(item.label)}${dot}</button><!--${labelCap}-->`;
}

function buildShell() {
  const groups = NAV_ITEMS.map(
    (g) =>
      `<div style="font-size:9.5px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:1px;padding:${
        g.group === "Market" ? "10px" : "16px"
      } 8px 6px;font-weight:600;">${g.group}</div>` + g.items.map(navButtonHtml).join(""),
  ).join("");

  const tickerItem = (t) => {
    const w = agentById(t.winner);
    return `<span style="font-family:var(--mono);font-size:11px;color:var(--inkDim);padding:0 22px;border-right:1px solid var(--lineSoft);">${esc(
      t.id + "  " + w.cloud + "/" + w.name + "  $" + t.price.toFixed(3) + "  " + t.latency,
    )}</span>`;
  };
  const tickerList = TASKS.map(tickerItem).join("");

  const ranges = [
    ["live", "Live"],
    ["24h", "24h"],
    ["7d", "7d"],
    ["all", "All"],
  ]
    .map(
      ([key, label]) =>
        `<button id="rng-${key}" data-action="range:${key}" style="${rangeStyle(false)}">${label}</button>`,
    )
    .join("");

  document.querySelector("#app").innerHTML = `
    <aside style="width:238px;flex:none;background:var(--bg2);border-right:1px solid var(--lineSoft);display:flex;flex-direction:column;padding:18px 14px 14px;">
      <div style="display:flex;align-items:center;gap:11px;padding:4px 6px 18px;">
        <div style="width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,var(--brand),var(--azure));position:relative;box-shadow:0 6px 18px rgba(110,139,255,.3);">
          <div style="position:absolute;inset:7px;border-radius:4px;background:var(--bg2);opacity:.7;clip-path:polygon(0 60%,28% 60%,38% 18%,52% 86%,64% 42%,100% 42%,100% 60%,0 60%);"></div>
        </div>
        <div>
          <div style="font-size:14px;font-weight:650;letter-spacing:.2px;line-height:1;">Agent Tasker</div>
          <div style="font-size:10px;color:var(--inkFaint);font-family:var(--mono);margin-top:3px;letter-spacing:.4px;">MARKET TERMINAL</div>
        </div>
      </div>
      ${groups}
      <div style="margin-top:auto;border-top:1px solid var(--lineSoft);padding:12px 8px 2px;">
        <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--inkDim);">
          <span style="width:7px;height:7px;border-radius:50%;background:var(--win);animation:at_pulse 2s infinite;"></span>
          Coordinator online
        </div>
        <div style="font-size:10px;color:var(--inkFaint);font-family:var(--mono);margin-top:5px;">GCP · us-central1 · v1.4.0</div>
      </div>
    </aside>

    <main style="flex:1;display:flex;flex-direction:column;min-width:0;">
      <header style="height:56px;flex:none;border-bottom:1px solid var(--lineSoft);display:flex;align-items:center;padding:0 24px;gap:16px;background:var(--bg2);">
        <div>
          <div id="page-title" style="font-size:15px;font-weight:600;line-height:1;"></div>
          <div id="page-sub" style="font-size:11px;color:var(--inkFaint);margin-top:3px;"></div>
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:10px;">
          <div style="display:flex;gap:2px;background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:3px;">${ranges}</div>
          <button data-action="go:submit" style="display:flex;align-items:center;gap:7px;background:var(--brand);color:#0a0d18;border:0;border-radius:9px;font:inherit;font-size:12.5px;font-weight:600;padding:9px 14px;cursor:pointer;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New task</button>
        </div>
      </header>

      <div style="height:34px;flex:none;border-bottom:1px solid var(--lineSoft);background:var(--bg);overflow:hidden;display:flex;align-items:center;position:relative;">
        <div style="position:absolute;left:0;top:0;bottom:0;z-index:2;display:flex;align-items:center;padding:0 12px 0 16px;background:var(--bg);font-size:9.5px;font-weight:700;letter-spacing:1.2px;color:var(--win);font-family:var(--mono);border-right:1px solid var(--lineSoft);">● SETTLED</div>
        <div style="display:flex;white-space:nowrap;animation:at_ticker 38s linear infinite;padding-left:130px;">${tickerList}${tickerList}</div>
      </div>

      <div style="flex:1;overflow-y:auto;overflow-x:hidden;">
        <div id="screen-content"></div>
      </div>
    </main>

    <div id="toast-root"></div>
  `;
}

// ---------------------------------------------------------------------------
// Chrome updates (cheap, no animation resets)
// ---------------------------------------------------------------------------

function updateChrome() {
  const screen = state.screen;
  const navActive = {
    dashboard: screen === "dashboard",
    live: screen === "live",
    ledger: screen === "ledger" || screen === "taskDetail",
    agents: screen === "agents" || screen === "agentDetail",
    submit: screen === "submit",
    pricing: screen === "pricing",
    health: screen === "health",
    settings: screen === "settings",
  };
  for (const key of Object.keys(navActive)) {
    const el = document.querySelector(`#nav-${key}`);
    if (el) el.style.cssText = navStyle(navActive[key]);
  }
  for (const key of ["live", "24h", "7d", "all"]) {
    const el = document.querySelector(`#rng-${key}`);
    if (el) el.style.cssText = rangeStyle(state.range === key);
  }
  document.querySelector("#page-title").textContent = TITLES[screen][0];
  document.querySelector("#page-sub").textContent = TITLES[screen][1];
}

function renderToast() {
  const root = document.querySelector("#toast-root");
  if (!state.toast) {
    root.innerHTML = "";
    return;
  }
  root.innerHTML = `<div style="position:fixed;bottom:24px;right:24px;z-index:50;display:flex;align-items:center;gap:10px;background:var(--panel2);border:1px solid var(--line);border-radius:11px;padding:13px 16px;box-shadow:0 12px 32px rgba(0,0,0,.45);animation:at_toast .25s ease;">
    <span style="width:8px;height:8px;border-radius:50%;background:var(--win);flex:none;box-shadow:0 0 0 4px rgba(54,211,153,.16);"></span>
    <span style="font-size:13px;color:var(--ink);">${esc(state.toast)}</span>
  </div>`;
}

// ---------------------------------------------------------------------------
// setState + render loop
// ---------------------------------------------------------------------------

function setState(patch) {
  Object.assign(state, patch);
  updateChrome();
  renderScreen();
  renderToast();
}

function renderScreen() {
  const host = document.querySelector("#screen-content");
  // Preserve focus + caret across re-render (ledger search, form fields).
  const active = document.activeElement;
  const activeId = active && host.contains(active) ? active.id : null;
  const selStart = activeId ? active.selectionStart : null;
  const selEnd = activeId ? active.selectionEnd : null;

  host.innerHTML = SCREENS[state.screen]();

  if (activeId) {
    const next = document.querySelector(`#${activeId}`);
    if (next) {
      next.focus();
      if (selStart != null && next.setSelectionRange) {
        try {
          next.setSelectionRange(selStart, selEnd);
        } catch {
          /* non-text input */
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Screen renderers
// ---------------------------------------------------------------------------

function sectionOpen(label, maxWidth, extra = "") {
  return `<section data-screen-label="${label}" style="padding:24px 26px 40px;max-width:${maxWidth}px;${extra}">`;
}

const SCREENS = {
  dashboard: renderDashboard,
  live: renderLive,
  submit: renderSubmit,
  taskDetail: renderTaskDetail,
  ledger: renderLedger,
  agents: renderAgents,
  agentDetail: renderAgentDetail,
  pricing: renderPricing,
  health: renderHealth,
  settings: renderSettings,
};

function renderDashboard() {
  const kpis = KPIS_BY_RANGE[state.range];
  const agents = AGENTS.map(agentDisplay);

  const intro = state.intro
    ? `<div style="display:flex;align-items:center;gap:14px;background:linear-gradient(90deg,rgba(110,139,255,.14),rgba(46,197,206,.06));border:1px solid rgba(110,139,255,.22);border-radius:13px;padding:14px 16px;margin-bottom:14px;">
        <div style="width:30px;height:30px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;background:rgba(110,139,255,.2);color:var(--brand);font-weight:700;">i</div>
        <div style="flex:1;font-size:13px;color:var(--ink);line-height:1.5;">Four AI agents privately bid to do each task — <strong>cheapest capable agent wins</strong>, and is paid the runner-up's price. It pays to bid honestly.</div>
        <button data-action="dismissIntro" style="background:transparent;border:1px solid var(--line);color:var(--inkDim);border-radius:8px;width:28px;height:28px;flex:none;cursor:pointer;font-size:15px;line-height:1;">×</button>
      </div>`
    : "";

  const kpiCards = kpis
    .map(
      (
        k,
      ) => `<div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:14px 16px;">
        <div style="font-size:10.5px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.7px;">${esc(k.lab)}</div>
        <div style="font-family:var(--mono);font-size:23px;font-weight:600;margin-top:8px;letter-spacing:-.5px;">${esc(k.val)}</div>
        <div style="font-size:11px;margin-top:5px;color:${k.color};">${esc(k.delta)}</div>
      </div>`,
    )
    .join("");

  const agentCards = agents
    .map(
      (
        a,
      ) => `<div data-action="agent:${a.id}" data-hov="card" style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:15px 16px;position:relative;overflow:hidden;cursor:pointer;border-left:3px solid ${a.color};transition:transform .12s,box-shadow .15s;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="${a.avatarStyle}">${a.initial}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;"><span style="font-weight:600;font-size:14.5px;">${esc(a.name)}</span><span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:5px;color:${a.color};background:${a.tint};border:1px solid ${a.tintLine};letter-spacing:.3px;">${a.cloud}</span></div>
            <div style="font-size:10px;color:var(--inkFaint);font-family:var(--mono);margin-top:2px;">${esc(a.runtime)}</div>
          </div>
        </div>
        <div style="font-size:11px;color:var(--inkFaint);margin:5px 0 13px;">${esc(a.modelLine)}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
          <div title="How often this agent wins the auction"><div style="font-family:var(--mono);font-size:17px;font-weight:600;">${a.winPct}</div><div style="font-size:9.5px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.5px;margin-top:2px;">win rate</div></div>
          <div title="Mean error in its cost guesses — lower means more accurate bids"><div style="font-family:var(--mono);font-size:17px;font-weight:600;">${a.mape}</div><div style="font-size:9.5px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.5px;margin-top:2px;">MAPE</div></div>
          <div title="Average price it charges per task it wins"><div style="font-family:var(--mono);font-size:17px;font-weight:600;">${a.avg}</div><div style="font-size:9.5px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.5px;margin-top:2px;">avg/task</div></div>
        </div>
        <div style="height:5px;border-radius:3px;background:var(--line);margin-top:13px;overflow:hidden;"><i style="${a.winBar}"></i></div>
      </div>`,
    )
    .join("");

  const feed = TASKS.slice(0, 4)
    .map((t) => {
      const w = agentById(t.winner);
      const c = COLORS[t.winner];
      const pill = t.tier === "—" ? "" : t.tier;
      const meta = (pill ? pill + "  ·  " : "") + t.steps + " · " + t.latency;
      const bars = bidBars(t)
        .map(
          (b) =>
            `<div style="${b.barStyle}"><span style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);font-size:9px;font-family:var(--mono);color:var(--inkFaint);white-space:nowrap;">${b.cap}</span></div>`,
        )
        .join("");
      return `<div data-action="task:${t.id}" data-hov="row" style="display:grid;grid-template-columns:1fr auto;gap:12px;padding:14px 16px;border-top:1px solid var(--lineSoft);cursor:pointer;transition:background .12s;">
        <div>
          <div style="font-size:13px;">${esc(t.prompt)}</div>
          <div style="display:flex;gap:5px;align-items:flex-end;height:38px;margin-top:11px;">${bars}</div>
          <div style="font-size:11px;color:var(--inkFaint);margin-top:9px;display:flex;gap:9px;align-items:center;">${esc(meta)}</div>
        </div>
        <div style="text-align:right;min-width:120px;">
          <div style="font-size:9.5px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.5px;">2nd price</div>
          <div style="font-family:var(--mono);font-size:16px;font-weight:600;color:${c};">${money(t.price)}</div>
          <div style="font-size:11px;margin-top:6px;font-weight:600;color:${c};">${esc(w.cloud + " · " + w.name)}</div>
          <div style="font-size:11px;color:var(--inkDim);margin-top:3px;font-family:var(--mono);">${esc(t.out)}</div>
        </div>
      </div>`;
    })
    .join("");

  const shareWin = [
    { label: "GCP (both)", color: "var(--gcp)", pct: "52%" },
    { label: "AWS", color: "var(--aws)", pct: "27%" },
    { label: "Azure", color: "var(--azure)", pct: "21%" },
  ];
  const shareSpend = [
    { label: "GCP", color: "var(--gcp)", pct: "58%" },
    { label: "Azure", color: "var(--azure)", pct: "30%" },
    { label: "AWS", color: "var(--aws)", pct: "12%" },
  ];
  const shareRow = (s) =>
    `<div style="display:flex;align-items:center;gap:10px;margin:11px 0;font-size:12.5px;">
      <div style="width:96px;color:var(--inkDim);display:flex;align-items:center;gap:7px;"><span style="width:9px;height:9px;border-radius:3px;background:${s.color};"></span>${esc(s.label)}</div>
      <div style="flex:1;height:8px;background:var(--line);border-radius:5px;overflow:hidden;"><i style="display:block;height:100%;width:${s.pct};background:${s.color};"></i></div>
      <div style="width:38px;text-align:right;font-family:var(--mono);font-size:12px;">${s.pct}</div>
    </div>`;

  const accuracy = [
    { name: "Nova", color: "var(--aws)", val: "9.8%", w: "18%" },
    { name: "Gemini", color: "var(--gcp)", val: "12.4%", w: "26%" },
    { name: "GPT", color: "var(--azure)", val: "15.1%", w: "32%" },
    { name: "Orchestrator", color: "var(--orch)", val: "23.7%", w: "50%" },
  ]
    .map(
      (m) =>
        `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--lineSoft);">
          <div style="width:118px;font-size:12px;color:var(--inkDim);display:flex;gap:7px;align-items:center;"><span style="width:9px;height:9px;border-radius:3px;background:${m.color};"></span>${esc(m.name)}</div>
          <div style="flex:1;height:6px;background:var(--line);border-radius:4px;overflow:hidden;"><i style="display:block;height:100%;width:${m.w};background:linear-gradient(90deg,var(--win),var(--warn));"></i></div>
          <div style="width:46px;text-align:right;font-family:var(--mono);font-size:12px;">${m.val}</div>
        </div>`,
    )
    .join("");

  const sectionHead = (n, title, helper) =>
    `<div style="display:flex;align-items:center;gap:9px;margin:2px 0 12px;"><span style="font-family:var(--mono);font-size:11px;color:var(--inkFaint);">${n}</span><h2 style="font-size:12px;letter-spacing:.5px;color:var(--inkDim);text-transform:uppercase;font-weight:600;margin:0;">${title}</h2><span style="font-size:11px;color:var(--inkFaint);">${helper}</span></div>`;

  return `${sectionOpen("Dashboard", 1340)}
    ${intro}
    <div style="display:flex;align-items:center;gap:18px;background:var(--panel);border:1px solid var(--lineSoft);border-radius:14px;padding:18px 22px;margin-bottom:18px;position:relative;overflow:hidden;">
      <div style="position:absolute;right:-30px;top:-30px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(110,139,255,.16),transparent 70%);pointer-events:none;"></div>
      <div style="flex:1;">
        <div style="font-size:10.5px;color:var(--brand);text-transform:uppercase;letter-spacing:1px;font-weight:600;">Live now</div>
        <div style="font-size:20px;font-weight:650;margin-top:5px;letter-spacing:-.2px;">Watch a sealed-bid auction unfold</div>
        <div style="font-size:13px;color:var(--inkDim);margin-top:5px;">Post a task, see four agents bid in real time, and watch the winner settle at the second-best price.</div>
      </div>
      <button data-action="startHero" data-hov="hero" style="display:flex;align-items:center;gap:9px;background:var(--brand);color:#0a0d18;border:0;border-radius:11px;font:inherit;font-size:14px;font-weight:650;padding:13px 20px;cursor:pointer;flex:none;transition:transform .1s,box-shadow .15s;box-shadow:0 6px 18px rgba(110,139,255,.28);"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Watch a live auction</button>
    </div>

    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:22px;">${kpiCards}</div>

    <div style="display:grid;grid-template-columns:1fr 366px;gap:18px;align-items:start;">
      <div>
        ${sectionHead("01", "Agent leaderboard", "win share &amp; bid accuracy")}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;">${agentCards}</div>
        ${sectionHead("02", "Recent auctions", "sealed bids → winner → second price")}
        <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;overflow:hidden;">${feed}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:18px;">
        <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:16px;">
          <h2 style="font-size:12px;letter-spacing:.5px;color:var(--inkDim);text-transform:uppercase;font-weight:600;margin:0 0 13px;">Win share by cloud</h2>
          ${shareWin.map(shareRow).join("")}
          <div style="border-top:1px solid var(--lineSoft);margin:15px 0 13px;"></div>
          <h2 style="font-size:12px;letter-spacing:.5px;color:var(--inkDim);text-transform:uppercase;font-weight:600;margin:0 0 13px;">Spend share by cloud</h2>
          ${shareSpend.map(shareRow).join("")}
        </div>
        <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:16px;">
          <h2 style="font-size:12px;letter-spacing:.5px;color:var(--inkDim);text-transform:uppercase;font-weight:600;margin:0 0 4px;">Bid accuracy</h2>
          <div style="font-size:11px;color:var(--inkFaint);margin-bottom:8px;">MAPE — lower is better</div>
          ${accuracy}
          <div style="font-size:11px;color:var(--inkFaint);margin-top:10px;line-height:1.5;">Orchestrator MAPE is dominated by step-count prediction, not tokenization.</div>
        </div>
      </div>
    </div>
  </section>`;
}

function renderLive() {
  const lt = state.liveTask || defaultLiveTask();
  const lw = agentById(lt.winner);
  const lc = COLORS[lt.winner];
  const past = ["awarded", "executing", "completed"].includes(state.livePhase);
  const order = ["gcp", "orch", "aws", "azure"];
  const winBid = Math.min(...order.map((k) => lt.bids[k]));
  const pIndex = { idle: 0, countdown: 1, revealing: 1, awarded: 2, executing: 3, completed: 4 }[
    state.livePhase
  ];

  const step = (need, color, label) => {
    const done = pIndex > need;
    const activeStep = pIndex === need;
    const dot = `width:9px;height:9px;border-radius:50%;flex:none;background:${
      done ? "var(--win)" : activeStep ? color : "var(--inkFaint)"
    };${activeStep ? "animation:at_blink 1s infinite;" : ""}`;
    const text = `font-size:12px;color:${done || activeStep ? "var(--ink)" : "var(--inkFaint)"};font-weight:${
      done || activeStep ? "600" : "400"
    };`;
    return `<div style="display:flex;gap:11px;align-items:center;"><span style="${dot}"></span><span style="${text}">${label}</span></div>`;
  };

  const max = Math.max(...order.map((k) => lt.bids[k]));
  const bidCards = order
    .map((k, i) => {
      const a = agentById(k);
      const c = COLORS[k];
      const v = lt.bids[k];
      const shown = state.liveRevealed > i;
      const isWin = k === lt.winner && past;
      const h = Math.max(Math.round((v / max) * 100), 16);
      const cardStyle =
        "border:1px solid " +
        (isWin ? c : "var(--lineSoft)") +
        ";background:" +
        (isWin ? `color-mix(in srgb, ${c} 14%, var(--panel))` : "var(--panel)") +
        ";border-radius:13px;padding:16px;position:relative;overflow:hidden;transition:all .3s;" +
        (isWin ? `box-shadow:0 0 28px color-mix(in srgb, ${c} 28%, transparent);` : "");
      const barStyle =
        "height:" +
        (shown ? h : 6) +
        "%;background:" +
        c +
        ";border-radius:6px 6px 0 0;transition:height .5s cubic-bezier(.2,.8,.2,1);opacity:" +
        (shown ? (isWin ? 1 : 0.55) : 0.25) +
        ";";
      const ribbon =
        "position:absolute;top:0;right:0;font-size:9px;font-weight:700;letter-spacing:1px;padding:4px 8px;border-radius:0 13px 0 9px;background:" +
        c +
        ";color:#08101c;display:" +
        (isWin ? "block" : "none") +
        ";";
      return `<div style="${cardStyle}">
        <div style="${ribbon}">WINNER</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
          <div style="${avatarStyle(c, 30)}">${INITIALS[k]}</div>
          <div>
            <div style="font-weight:600;font-size:14px;line-height:1.1;">${esc(a.name)}</div>
            <div style="font-size:9.5px;font-weight:700;color:${c};letter-spacing:.3px;margin-top:2px;">${a.cloud}</div>
          </div>
        </div>
        <div style="height:120px;display:flex;align-items:flex-end;"><div style="width:100%;${barStyle}"></div></div>
        <div style="font-family:var(--mono);font-size:19px;font-weight:600;margin-top:14px;color:${c};">${shown ? money(v) : "— — —"}</div>
        <div style="font-size:10.5px;color:var(--inkFaint);margin-top:3px;">${esc(a.runtime)}</div>
      </div>`;
    })
    .join("");

  const countdown =
    state.livePhase === "countdown"
      ? `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:3;background:rgba(7,9,15,.66);border-radius:14px;backdrop-filter:blur(2px);">
          <div style="font-size:11px;color:var(--inkDim);text-transform:uppercase;letter-spacing:2.5px;">Sealed bids closing</div>
          <div style="font-family:var(--mono);font-size:88px;font-weight:700;color:var(--brand);line-height:1;margin-top:6px;">${state.liveCount}</div>
        </div>`
      : "";

  let execInner = "";
  if (state.livePhase === "executing") {
    execInner = `<div style="display:flex;align-items:center;gap:10px;font-size:12px;color:var(--inkDim);margin-bottom:12px;"><span style="width:13px;height:13px;border:2px solid var(--brand);border-top-color:transparent;border-radius:50%;animation:at_spin .7s linear infinite;display:inline-block;"></span>Agent running… ${state.execProgress}%</div>
      <div style="height:9px;background:var(--line);border-radius:7px;overflow:hidden;"><div style="width:${state.execProgress}%;height:100%;background:linear-gradient(90deg,var(--brand),var(--azure));border-radius:7px;transition:width .12s;"></div></div>`;
  } else if (state.livePhase === "completed") {
    execInner = `<div style="display:flex;align-items:center;gap:8px;color:var(--win);font-size:13px;font-weight:600;margin-bottom:14px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Completed in ${esc(lt.latency)}</div>
      <div style="font-size:10.5px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.6px;">Output</div>
      <div style="font-family:var(--mono);font-size:13px;background:var(--bg2);border:1px solid var(--lineSoft);border-radius:9px;padding:12px 14px;margin-top:7px;color:var(--ink);">${esc(lt.out)}</div>`;
  }

  const resultBlock = past
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">
        <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:18px 20px;">
          <h3 style="margin:0 0 14px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--inkDim);">Auction result</h3>
          <div style="display:flex;align-items:baseline;gap:10px;"><span style="font-size:11px;color:var(--inkFaint);width:110px;">Winner</span><span style="font-weight:600;font-size:15px;color:${lc};">${esc(lw.cloud + " · " + lw.name)}</span></div>
          <div style="display:flex;align-items:baseline;gap:10px;margin-top:11px;"><span style="font-size:11px;color:var(--inkFaint);width:110px;">Winning bid</span><span style="font-family:var(--mono);font-size:14px;color:var(--inkDim);text-decoration:line-through;">${money(winBid)}</span></div>
          <div style="display:flex;align-items:baseline;gap:10px;margin-top:11px;"><span style="font-size:11px;color:var(--inkFaint);width:110px;">Clears (2nd price)</span><span style="font-family:var(--mono);font-size:26px;font-weight:700;color:var(--win);">${money(lt.price)}</span></div>
          <div style="font-size:11px;color:var(--inkFaint);line-height:1.55;margin-top:14px;border-top:1px solid var(--lineSoft);padding-top:12px;">Under a Vickrey auction the lowest bidder wins but is paid the <strong style="color:var(--inkDim);">second-lowest</strong> bid — making truthful cost estimation the dominant strategy.</div>
        </div>
        <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:18px 20px;">
          <h3 style="margin:0 0 14px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--inkDim);">Execution</h3>
          ${execInner}
        </div>
      </div>`
    : "";

  return `${sectionOpen("Live Auction", 1180)}
    <div style="display:flex;gap:16px;align-items:stretch;margin-bottom:16px;">
      <div style="flex:1;background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:18px 20px;">
        <div style="font-size:10.5px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.8px;">Task on the block</div>
        <div style="font-size:18px;font-weight:600;margin:9px 0 13px;line-height:1.35;">${esc(lt.prompt)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <span style="font-size:10.5px;font-family:var(--mono);padding:4px 9px;border-radius:6px;border:1px solid var(--line);color:var(--inkDim);">${esc(lt.minTier ? "min_tier: " + lt.minTier : "no floor")}</span>
          <span style="font-size:10.5px;font-family:var(--mono);padding:4px 9px;border-radius:6px;border:1px solid var(--line);color:var(--inkDim);">Vickrey · second-price</span>
          <span style="font-size:10.5px;font-family:var(--mono);padding:4px 9px;border-radius:6px;border:1px solid var(--line);color:var(--inkDim);">4 bidders</span>
        </div>
      </div>
      <div style="width:236px;flex:none;background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:18px;display:flex;flex-direction:column;gap:15px;justify-content:center;">
        ${step(1, lc, "Sealed bidding")}
        ${step(2, lc, "Awarded")}
        ${step(3, lc, "Executing")}
        ${step(4, lc, "Settled")}
      </div>
    </div>

    <div style="position:relative;background:var(--panel);border:1px solid var(--lineSoft);border-radius:14px;padding:26px 24px;">
      ${countdown}
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;align-items:stretch;">${bidCards}</div>
    </div>

    ${resultBlock}

    <div style="margin-top:16px;display:flex;gap:10px;">
      <button data-action="restartAuction" style="display:flex;align-items:center;gap:7px;background:var(--brand);color:#0a0d18;border:0;border-radius:9px;font:inherit;font-size:12.5px;font-weight:600;padding:10px 16px;cursor:pointer;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>Run again</button>
      <button data-action="newRandomAuction" style="background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:9px;font:inherit;font-size:12.5px;padding:10px 16px;cursor:pointer;">New random task</button>
    </div>
  </section>`;
}

function renderSubmit() {
  const f = state.form;
  const submitLabel =
    state.submitState === "submitting" ? "Posting to market…" : "Submit to auction";
  const errorBlock = state.formError
    ? `<div style="display:flex;align-items:center;gap:7px;color:var(--loss);font-size:12.5px;margin-top:11px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>${esc(state.formError)}</div>`
    : "";

  return `${sectionOpen("Submit Task", 1040, "display:grid;grid-template-columns:1fr 320px;gap:18px;align-items:start;")}
    <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:20px 22px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <h2 style="margin:0;font-size:14px;font-weight:600;">New task</h2>
        <button data-action="loadExample" style="background:transparent;border:1px solid var(--line);color:var(--inkDim);border-radius:8px;font:inherit;font-size:11.5px;padding:6px 11px;cursor:pointer;">Load example</button>
      </div>
      <label for="f-prompt" style="font-size:11px;color:var(--inkDim);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:7px;">Prompt</label>
      <textarea id="f-prompt" data-field="prompt" placeholder="Describe the task the agents will bid on…" style="width:100%;box-sizing:border-box;min-height:200px;resize:vertical;background:var(--bg2);border:1px solid var(--line);border-radius:10px;color:var(--ink);font:inherit;font-size:13.5px;line-height:1.5;padding:13px 14px;">${esc(f.prompt)}</textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;">
        <div>
          <label for="f-tier" style="font-size:11px;color:var(--inkDim);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:7px;">Minimum tier</label>
          <select id="f-tier" data-field="minTier" style="width:100%;box-sizing:border-box;background:var(--bg2);border:1px solid var(--line);border-radius:10px;color:var(--ink);font:inherit;font-size:13px;padding:11px 12px;">
            <option value=""${f.minTier === "" ? " selected" : ""}>No floor — cheapest capable wins</option>
            <option value="small"${f.minTier === "small" ? " selected" : ""}>Small</option>
            <option value="medium"${f.minTier === "medium" ? " selected" : ""}>Medium</option>
            <option value="frontier"${f.minTier === "frontier" ? " selected" : ""}>Frontier</option>
          </select>
        </div>
        <div>
          <label for="f-callback" style="font-size:11px;color:var(--inkDim);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:7px;">Callback URL <span style="color:var(--inkFaint);text-transform:none;">· optional</span></label>
          <input id="f-callback" data-field="callback" value="${esc(f.callback)}" placeholder="https://…" style="width:100%;box-sizing:border-box;background:var(--bg2);border:1px solid var(--line);border-radius:10px;color:var(--ink);font:inherit;font-size:13px;padding:11px 12px;" />
        </div>
      </div>
      <button data-action="submitTask" data-hov="btn" style="margin-top:18px;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--brand);color:#0a0d18;border:0;border-radius:10px;font:inherit;font-size:13.5px;font-weight:600;padding:13px;cursor:pointer;transition:transform .1s,box-shadow .15s;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>${submitLabel}</button>
      ${errorBlock}
    </div>
    <div style="display:flex;flex-direction:column;gap:18px;">
      <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:18px;">
        <h3 style="margin:0 0 12px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--inkDim);">How the market works</h3>
        <div style="font-size:12.5px;color:var(--inkDim);line-height:1.6;">Your prompt is broadcast to all eligible agents. Each privately estimates its USD cost and submits a <strong style="color:var(--ink);">sealed bid</strong>. The lowest bidder wins and is paid the <strong style="color:var(--ink);">second-lowest</strong> bid (Vickrey).</div>
      </div>
      <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:18px;">
        <h3 style="margin:0 0 12px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--inkDim);">Tier floor</h3>
        <div style="font-size:12.5px;color:var(--inkDim);line-height:1.6;">A minimum tier excludes agents below that capability class from bidding — use it when a task genuinely needs a frontier model.</div>
      </div>
    </div>
  </section>`;
}

function renderTaskDetail() {
  const t0 = taskById(state.taskId);
  const w = agentById(t0.winner);
  const c = COLORS[t0.winner];
  const winBid = Math.min(...["gcp", "orch", "aws", "azure"].map((k) => t0.bids[k]));
  const statusColor = t0.status === "completed" ? "var(--win)" : "var(--loss)";
  const statusBg = t0.status === "completed" ? "rgba(54,211,153,.12)" : "rgba(240,107,107,.12)";

  const bars = bidBars(t0)
    .map(
      (b) =>
        `<div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;"><div style="${b.barStyle};width:100%;"><span style="position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:10px;font-family:var(--mono);color:var(--inkFaint);">${b.cap}</span></div></div>`,
    )
    .join("");

  const trace = stepTrace(t0);
  const traceBlock = t0.trace
    ? `<div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:20px;">
        <h3 style="margin:0 0 14px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--inkDim);">Step trace <span style="color:var(--inkFaint);text-transform:none;letter-spacing:0;">· GAEP orchestrator</span></h3>
        ${trace
          .map(
            (
              st,
            ) => `<div style="display:flex;gap:13px;padding:11px 0;border-top:1px solid var(--lineSoft);">
              <div style="font-family:var(--mono);font-size:12px;color:var(--orch);flex:none;width:22px;">#${st.i}</div>
              <div style="flex:1;"><div style="font-size:13px;">${esc(st.d)}</div><div style="font-size:11px;color:var(--inkFaint);font-family:var(--mono);margin-top:4px;">${esc(st.actions)}</div></div>
              <span style="font-size:10px;font-family:var(--mono);color:var(--win);align-self:flex-start;">${esc(st.state)}</span>
            </div>`,
          )
          .join("")}
      </div>`
    : "";

  return `${sectionOpen("Task Detail", 1180)}
    <button data-action="go:ledger" style="display:flex;align-items:center;gap:6px;background:transparent;border:0;color:var(--inkDim);font:inherit;font-size:12px;cursor:pointer;margin-bottom:16px;padding:0;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>Back to ledger</button>
    <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:18px;">
      <div style="flex:1;">
        <div style="font-family:var(--mono);font-size:11px;color:var(--inkFaint);">${esc(t0.id)}</div>
        <div style="font-size:19px;font-weight:600;margin-top:6px;line-height:1.35;">${esc(t0.prompt)}</div>
      </div>
      <span style="font-size:11px;font-family:var(--mono);padding:6px 12px;border-radius:7px;color:${statusColor};background:${statusBg};">${esc(t0.status)}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 340px;gap:18px;align-items:start;">
      <div style="display:flex;flex-direction:column;gap:18px;">
        <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:20px;">
          <h3 style="margin:0 0 18px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--inkDim);">Sealed bids</h3>
          <div style="display:flex;gap:20px;align-items:flex-end;height:130px;padding-top:18px;">${bars}</div>
          <div style="display:flex;gap:18px;margin-top:14px;border-top:1px solid var(--lineSoft);padding-top:14px;">
            <div><div style="font-size:10px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.5px;">Winner</div><div style="font-weight:600;font-size:14px;margin-top:4px;color:${c};">${esc(w.cloud + " · " + w.name)}</div></div>
            <div><div style="font-size:10px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.5px;">Winning bid</div><div style="font-family:var(--mono);font-size:14px;margin-top:4px;color:var(--inkDim);text-decoration:line-through;">${money(winBid)}</div></div>
            <div><div style="font-size:10px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.5px;">Clears · 2nd price</div><div style="font-family:var(--mono);font-size:18px;font-weight:700;margin-top:2px;color:var(--win);">${money(t0.price)}</div></div>
          </div>
        </div>
        <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:20px;">
          <h3 style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--inkDim);">Output</h3>
          <div style="font-family:var(--mono);font-size:13px;background:var(--bg2);border:1px solid var(--lineSoft);border-radius:9px;padding:13px 14px;color:var(--ink);">${esc(t0.out)}</div>
        </div>
        ${traceBlock}
      </div>
      <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:18px;">
        <h3 style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--inkDim);">Metadata</h3>
        ${[
          ["Tier floor", t0.tier === "—" ? "no floor" : t0.tier],
          ["Latency", t0.latency],
          ["Steps", t0.steps],
          ["Usage", t0.usage],
        ]
          .map(
            ([k, v]) =>
              `<div style="display:flex;justify-content:space-between;padding:11px 0;border-top:1px solid var(--lineSoft);font-size:12.5px;"><span style="color:var(--inkFaint);">${k}</span><span style="font-family:var(--mono);">${esc(v)}</span></div>`,
          )
          .join("")}
      </div>
    </div>
  </section>`;
}

function renderLedger() {
  const list = filteredTasks();
  const statChips = [
    ["all", "All"],
    ["completed", "Completed"],
    ["failed", "Failed"],
  ]
    .map(
      ([k, label]) =>
        `<button data-action="stat:${k}" style="${fStyle(state.fStatus === k)}">${label}</button>`,
    )
    .join("");
  const winChips = [
    ["all", "All agents"],
    ["gcp", "Gemini"],
    ["orch", "Orch"],
    ["aws", "Nova"],
    ["azure", "GPT"],
  ]
    .map(
      ([k, label]) =>
        `<button data-action="win:${k}" style="${fStyle(state.fWinner === k)}">${label}</button>`,
    )
    .join("");

  const cols = "96px 1fr 150px 90px 70px 110px 80px";
  const rows = list
    .map((t) => {
      const w = agentById(t.winner);
      const c = COLORS[t.winner];
      const rowAccent = t.status === "failed" ? "var(--loss)" : "transparent";
      const statusStyle =
        "font-size:10.5px;font-family:var(--mono);padding:3px 8px;border-radius:5px;" +
        (t.status === "completed"
          ? "color:var(--win);background:rgba(54,211,153,.12);border:1px solid rgba(54,211,153,.25);"
          : "color:var(--loss);background:rgba(240,107,107,.12);border:1px solid rgba(240,107,107,.25);");
      const badge =
        "font-size:9.5px;font-weight:700;padding:2px 6px;border-radius:5px;color:" +
        c +
        ";background:color-mix(in srgb, " +
        c +
        " 16%, transparent);";
      return `<div data-action="task:${t.id}" data-hov="row" style="display:grid;grid-template-columns:${cols};gap:12px;padding:13px 16px;border-top:1px solid var(--lineSoft);border-left:2px solid ${rowAccent};cursor:pointer;align-items:center;font-size:13px;transition:background .12s;">
        <span style="font-family:var(--mono);font-size:11.5px;color:var(--inkDim);">${esc(t.id)}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.prompt)}</span>
        <span style="display:flex;align-items:center;gap:7px;"><span style="${badge}">${esc(w.cloud + " · " + w.name)}</span></span>
        <span style="text-align:right;font-family:var(--mono);font-size:12.5px;">${money(t.price)}</span>
        <span style="text-align:right;font-family:var(--mono);font-size:12px;color:var(--inkDim);">${esc(t.latency)}</span>
        <span><span style="${statusStyle}">${esc(t.status)}</span></span>
        <span style="text-align:right;font-size:11.5px;color:var(--inkFaint);">${esc(t.ts)}</span>
      </div>`;
    })
    .join("");

  const empty =
    list.length === 0
      ? `<div style="padding:48px 16px;text-align:center;"><div style="font-size:14px;color:var(--inkDim);">No tasks match your filters</div><div style="font-size:12px;color:var(--inkFaint);margin-top:6px;">Try a different agent, status, or search term.</div></div>`
      : "";

  return `${sectionOpen("Ledger", 1340)}
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">
      <div style="position:relative;flex:1;min-width:220px;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--inkFaint)" stroke-width="2" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/></svg>
        <input id="ledger-search" data-field="query" value="${esc(state.query)}" placeholder="Search prompt or task id…" style="width:100%;box-sizing:border-box;background:var(--panel);border:1px solid var(--line);border-radius:9px;color:var(--ink);font:inherit;font-size:13px;padding:10px 12px 10px 34px;" />
      </div>
      <div style="display:flex;gap:6px;">${statChips}</div>
      <div style="display:flex;gap:6px;">${winChips}</div>
    </div>
    <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;overflow:hidden;">
      <div style="display:grid;grid-template-columns:${cols};gap:12px;padding:11px 16px;border-bottom:1px solid var(--line);font-size:10px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.6px;">
        <span>Task</span><span>Prompt</span><span>Winner</span><span style="text-align:right;" title="What the winner is paid: the second-lowest bid (Vickrey)">2nd price</span><span style="text-align:right;">Latency</span><span>Status</span><span style="text-align:right;">Time</span>
      </div>
      ${rows}${empty}
    </div>
    <div style="font-size:11.5px;color:var(--inkFaint);margin-top:12px;font-family:var(--mono);">${list.length} tasks</div>
  </section>`;
}

function renderAgents() {
  const cards = AGENTS.map(agentDisplay)
    .map(
      (
        a,
      ) => `<div data-action="agent:${a.id}" data-hov="card" style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:14px;padding:20px;cursor:pointer;border-left:3px solid ${a.color};transition:transform .12s,box-shadow .15s;">
        <div style="display:flex;align-items:center;gap:11px;margin-bottom:4px;">
          <div style="${a.avatarStyle}">${a.initial}</div>
          <span style="font-weight:600;font-size:17px;">${esc(a.name)}</span>
          <span style="font-size:10px;font-weight:700;padding:3px 7px;border-radius:6px;color:${a.color};background:${a.tint};border:1px solid ${a.tintLine};">${a.cloud}</span>
          <span style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:10.5px;font-family:var(--mono);color:${a.deployColor};"><span style="width:7px;height:7px;border-radius:50%;background:${a.deployColor};"></span>${a.deployLabel}</span>
        </div>
        <div style="font-size:12px;color:var(--inkFaint);margin-bottom:16px;">${esc(a.model + " · " + a.specialty)}</div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;">
          <div style="display:flex;gap:20px;">
            <div><div style="font-family:var(--mono);font-size:21px;font-weight:600;">${a.winPct}</div><div style="font-size:9.5px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.5px;margin-top:2px;">win rate</div></div>
            <div><div style="font-family:var(--mono);font-size:21px;font-weight:600;">${a.mape}</div><div style="font-size:9.5px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.5px;margin-top:2px;">MAPE</div></div>
            <div><div style="font-family:var(--mono);font-size:21px;font-weight:600;">${a.avg}</div><div style="font-size:9.5px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.5px;margin-top:2px;">avg/task</div></div>
          </div>
          <svg width="96" height="30" viewBox="0 0 96 30" fill="none" style="flex:none;" aria-hidden="true"><polyline points="${a.spark}" fill="none" stroke="${a.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>
        </div>
      </div>`,
    )
    .join("");
  return `${sectionOpen("Agents", 1180)}<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">${cards}</div></section>`;
}

function renderAgentDetail() {
  const ad = agentDisplay(agentById(state.agentId));
  const adAvatar = `width:46px;height:46px;border-radius:13px;flex:none;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:19px;background:color-mix(in srgb, ${ad.color} 18%, transparent);color:${ad.color};border:1px solid color-mix(in srgb, ${ad.color} 34%, transparent);`;

  const statCard = (lab, val, title) =>
    `<div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:16px;"${
      title ? ` title="${title}"` : ""
    }><div style="font-size:10px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.6px;">${lab}</div><div style="font-family:var(--mono);font-size:24px;font-weight:600;margin-top:7px;">${val}</div></div>`;

  const recent = recentForAgent(state.agentId)
    .map((t) => {
      const statusStyle =
        "font-size:10px;font-family:var(--mono);padding:2px 7px;border-radius:5px;" +
        (t.status === "completed"
          ? "color:var(--win);background:rgba(54,211,153,.12);"
          : "color:var(--loss);background:rgba(240,107,107,.12);");
      return `<div data-action="task:${t.id}" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--lineSoft);cursor:pointer;font-size:12.5px;">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.prompt)}</span>
        <span style="font-family:var(--mono);font-size:12px;color:var(--inkDim);">${money(t.price)}</span>
        <span style="font-family:var(--mono);font-size:11.5px;color:var(--inkFaint);width:44px;text-align:right;">${esc(t.latency)}</span>
        <span style="${statusStyle}">${esc(t.status)}</span>
      </div>`;
    })
    .join("");

  const healthRows = [
    ["Region", ad.region],
    ["p50 latency", ad.p50 + "s"],
    ["p95 latency", ad.p95 + "s"],
    ["Cold starts", ad.cold],
    ["Specialty", ad.specialty],
  ]
    .map(
      ([k, v], i) =>
        `<div style="display:flex;justify-content:space-between;padding:11px 0;border-top:1px solid var(--lineSoft);font-size:12.5px;"><span style="color:var(--inkFaint);">${k}</span><span${
          i === 4 ? "" : ' style="font-family:var(--mono);"'
        }>${esc(v)}</span></div>`,
    )
    .join("");

  return `${sectionOpen("Agent Detail", 1180)}
    <button data-action="go:agents" style="display:flex;align-items:center;gap:6px;background:transparent;border:0;color:var(--inkDim);font:inherit;font-size:12px;cursor:pointer;margin-bottom:16px;padding:0;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>All agents</button>
    <div style="display:flex;align-items:center;gap:13px;margin-bottom:20px;">
      <div style="${adAvatar}">${ad.initial}</div>
      <h2 style="margin:0;font-size:24px;font-weight:650;">${esc(ad.name)}</h2>
      <span style="font-size:11px;font-weight:700;padding:4px 9px;border-radius:7px;color:${ad.color};background:${ad.tint};border:1px solid ${ad.tintLine};">${ad.cloud}</span>
      <span style="font-size:12px;color:var(--inkFaint);font-family:var(--mono);">${esc(ad.runtime)}</span>
      <span style="margin-left:auto;display:flex;align-items:center;gap:7px;font-size:11.5px;font-family:var(--mono);color:${ad.deployColor};"><span style="width:8px;height:8px;border-radius:50%;background:${ad.deployColor};"></span>${ad.deployLabel}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px;">
      ${statCard("Win rate", ad.winPct)}
      ${statCard("Bid MAPE", ad.mape, "Mean error in its cost guesses — lower means more accurate bids")}
      ${statCard("Avg / task", ad.avg)}
      ${statCard("Tasks · 7d", ad.tasks7d)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 320px;gap:18px;align-items:start;">
      <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:20px;">
        <h3 style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--inkDim);">Win rate · 7-day trend</h3>
        <div style="font-size:11px;color:var(--inkFaint);margin-bottom:14px;">${esc(ad.model)}</div>
        <svg width="100%" height="140" viewBox="0 0 520 140" preserveAspectRatio="none" aria-hidden="true"><polyline points="${ad.sparkBig}" fill="none" stroke="${ad.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>
        <div style="margin-top:14px;border-top:1px solid var(--lineSoft);padding-top:14px;">
          <h3 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--inkDim);">Recent wins</h3>
          ${recent}
        </div>
      </div>
      <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:18px;">
        <h3 style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--inkDim);">Runtime &amp; health</h3>
        ${healthRows}
      </div>
    </div>
  </section>`;
}

function renderPricing() {
  const cols = "1fr 110px 130px 130px 90px";
  const rows = PRICING.map((p) => {
    const c = COLORS[p.id];
    const a = agentById(p.id);
    const badge =
      "font-size:9.5px;font-weight:700;padding:2px 6px;border-radius:5px;color:" +
      c +
      ";background:color-mix(in srgb, " +
      c +
      " 16%, transparent);";
    return `<div style="display:grid;grid-template-columns:${cols};gap:12px;padding:15px 18px;border-top:1px solid var(--lineSoft);align-items:center;">
      <div style="display:flex;align-items:center;gap:9px;"><span style="${badge}">${esc(a.cloud + " · " + a.name)}</span><span style="font-size:13.5px;">${esc(p.model)}</span></div>
      <span style="font-size:12px;color:var(--inkDim);">${esc(p.tier)}</span>
      <span style="text-align:right;font-family:var(--mono);font-size:13px;">$${p.inP.toFixed(2)}</span>
      <span style="text-align:right;font-family:var(--mono);font-size:13px;">$${p.outP.toFixed(2)}</span>
      <span style="text-align:right;font-family:var(--mono);font-size:12.5px;color:var(--inkDim);">${esc(p.ctx)}</span>
    </div>`;
  }).join("");

  return `${sectionOpen("Pricing", 1100)}
    <div style="display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:14px 18px;margin-bottom:16px;">
      <span style="width:9px;height:9px;border-radius:50%;background:var(--win);animation:at_pulse 2s infinite;"></span>
      <div style="font-size:13px;">Daily pricing refresh function <strong style="color:var(--win);">healthy</strong></div>
      <div style="margin-left:auto;font-family:var(--mono);font-size:11.5px;color:var(--inkFaint);">last run 04:00 UTC · next in 6h 12m</div>
    </div>
    <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;overflow:hidden;">
      <div style="display:grid;grid-template-columns:${cols};gap:12px;padding:12px 18px;border-bottom:1px solid var(--line);font-size:10px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.6px;">
        <span>Model</span><span>Tier</span><span style="text-align:right;">Input $/Mtok</span><span style="text-align:right;">Output $/Mtok</span><span style="text-align:right;">Context</span>
      </div>
      ${rows}
    </div>
    <div style="font-size:11.5px;color:var(--inkFaint);margin-top:14px;line-height:1.6;">Bids are derived from these per-token rates plus each agent's predicted input/output token counts. Prices are pulled daily from each provider's list rate and written to the Firestore pricing collection; the orchestrator adds a per-step overhead multiplier.</div>
  </section>`;
}

function renderHealth() {
  const phases = PHASES.map(
    (
      ph,
    ) => `<div style="display:flex;gap:12px;align-items:flex-start;padding:11px 0;border-top:1px solid var(--lineSoft);">
      <span style="width:8px;height:8px;border-radius:50%;background:${ph.color};margin-top:5px;flex:none;"></span>
      <div style="flex:1;"><div style="font-size:13px;font-weight:600;">${esc(ph.n + " — " + ph.t)}</div><div style="font-size:11px;color:var(--inkFaint);margin-top:3px;line-height:1.5;">${esc(ph.detail)}</div></div>
      <span style="font-size:10.5px;font-family:var(--mono);color:${ph.color};">${esc(ph.state)}</span>
    </div>`,
  ).join("");

  const cols = "1fr 130px 90px 90px 90px 150px";
  const rows = AGENTS.map((a) => {
    const c = COLORS[a.id];
    const deployColor = a.deploy === "live" ? "var(--win)" : "var(--warn)";
    const deployLabel = a.deploy === "live" ? "Deployed · live" : "Staged · CI gated";
    const dot =
      "width:8px;height:8px;border-radius:50%;background:" +
      (a.deploy === "live" ? "var(--win)" : "var(--warn)") +
      ";" +
      (a.deploy === "live" ? "animation:at_pulse 2s infinite;" : "");
    return `<div style="display:grid;grid-template-columns:${cols};gap:12px;padding:14px 18px;border-top:1px solid var(--lineSoft);align-items:center;font-size:13px;">
      <span style="display:flex;align-items:center;gap:9px;"><span style="${dot}"></span><span style="font-weight:600;color:${c};">${esc(a.cloud + " · " + a.name)}</span></span>
      <span style="font-family:var(--mono);font-size:12px;color:var(--inkDim);">${esc(a.region)}</span>
      <span style="text-align:right;font-family:var(--mono);font-size:12.5px;">${a.p50}s</span>
      <span style="text-align:right;font-family:var(--mono);font-size:12.5px;">${a.p95}s</span>
      <span style="text-align:right;font-family:var(--mono);font-size:12.5px;color:var(--inkDim);">${esc(a.cold)}</span>
      <span style="text-align:right;font-size:11px;font-family:var(--mono);color:${deployColor};">${deployLabel}</span>
    </div>`;
  }).join("");

  const coordRows = [
    ["Region", "GCP · us-central1", ""],
    ["Ledger", "Firestore · 767 records", ""],
    ["Auth", "OIDC + RS256 JWT", ""],
    ["JWKS", "published · 2 keys", "color:var(--win);"],
  ]
    .map(
      ([k, v, extra]) =>
        `<div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--lineSoft);font-size:12.5px;"><span style="color:var(--inkFaint);">${k}</span><span style="font-family:var(--mono);${extra}">${esc(v)}</span></div>`,
    )
    .join("");

  return `${sectionOpen("System Health", 1180)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px;">
      <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:18px 20px;">
        <div style="display:flex;align-items:center;gap:10px;"><span style="width:9px;height:9px;border-radius:50%;background:var(--win);animation:at_pulse 2s infinite;"></span><h3 style="margin:0;font-size:13px;">Coordinator</h3><span style="margin-left:auto;font-size:11px;font-family:var(--mono);color:var(--win);">online</span></div>
        <div style="margin-top:12px;">${coordRows}</div>
      </div>
      <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:18px 20px;">
        <h3 style="margin:0 0 12px;font-size:13px;">Deploy phases</h3>
        ${phases}
      </div>
    </div>
    <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;overflow:hidden;">
      <div style="display:grid;grid-template-columns:${cols};gap:12px;padding:12px 18px;border-bottom:1px solid var(--line);font-size:10px;color:var(--inkFaint);text-transform:uppercase;letter-spacing:.6px;">
        <span>Agent</span><span>Region</span><span style="text-align:right;">p50</span><span style="text-align:right;">p95</span><span style="text-align:right;">Cold</span><span style="text-align:right;">Deploy</span>
      </div>
      ${rows}
    </div>
  </section>`;
}

function renderSettings() {
  const s = state.settings;
  return `${sectionOpen("Settings", 760)}
    <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:20px 22px;margin-bottom:16px;">
      <h3 style="margin:0 0 14px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--inkDim);">Coordinator connection</h3>
      <label for="set-api" style="font-size:11px;color:var(--inkDim);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:7px;">API base URL</label>
      <input id="set-api" data-field="apiBase" value="${esc(s.apiBase)}" style="width:100%;box-sizing:border-box;background:var(--bg2);border:1px solid var(--line);border-radius:10px;color:var(--ink);font:inherit;font-family:var(--mono);font-size:12.5px;padding:11px 13px;" />
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;">
        <div>
          <label for="set-poll" style="font-size:11px;color:var(--inkDim);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:7px;">Poll interval</label>
          <select id="set-poll" data-field="poll" style="width:100%;box-sizing:border-box;background:var(--bg2);border:1px solid var(--line);border-radius:10px;color:var(--ink);font:inherit;font-size:13px;padding:11px 12px;">
            <option value="1"${s.poll === "1" ? " selected" : ""}>Every 1s</option>
            <option value="2"${s.poll === "2" ? " selected" : ""}>Every 2s</option>
            <option value="5"${s.poll === "5" ? " selected" : ""}>Every 5s</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--inkDim);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:7px;">Auth mode</label>
          <div style="background:var(--bg2);border:1px solid var(--line);border-radius:10px;font-size:12.5px;padding:11px 12px;font-family:var(--mono);color:var(--inkDim);">OIDC + RS256 (locked)</div>
        </div>
      </div>
    </div>
    <div style="background:var(--panel);border:1px solid var(--lineSoft);border-radius:13px;padding:20px 22px;">
      <h3 style="margin:0 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--inkDim);">Security</h3>
      <div style="font-size:12.5px;color:var(--inkDim);line-height:1.65;">Agents authenticate the coordinator with a Google OIDC token in <span style="font-family:var(--mono);color:var(--ink);">X-Serverless-Authorization</span> plus a per-task RS256 JWT in <span style="font-family:var(--mono);color:var(--ink);">Authorization</span>, verified against the published JWKS. Cloud Run services are locked to coordinator-only <span style="font-family:var(--mono);color:var(--ink);">roles/run.invoker</span>.</div>
    </div>
    <button data-action="saveSettings" style="margin-top:16px;background:var(--brand);color:#0a0d18;border:0;border-radius:10px;font:inherit;font-size:13px;font-weight:600;padding:11px 20px;cursor:pointer;">Save changes</button>
  </section>`;
}

// ---------------------------------------------------------------------------
// Event handling (delegated)
// ---------------------------------------------------------------------------

function loadExample() {
  setState({
    form: {
      prompt:
        "Summarize the tradeoffs of a direct single-call Gemini agent versus a GAEP orchestrator for a multi-step research task. Include cost, latency, and failure-mode considerations.",
      minTier: "medium",
      callback: "",
    },
  });
}

function submitTask() {
  const f = state.form;
  if (!f.prompt.trim()) {
    setState({ formError: "Add a prompt so the agents have something to bid on." });
    return;
  }
  setState({ formError: "" });
  const task = genAuction(f.prompt, f.minTier);
  showToast("Task posted — agents are bidding");
  startAuction(task);
}

function handleAction(action) {
  if (action.startsWith("go:")) {
    setState({ screen: action.slice(3) });
    return;
  }
  if (action.startsWith("range:")) {
    setState({ range: action.slice(6) });
    return;
  }
  if (action.startsWith("agent:")) {
    setState({ screen: "agentDetail", agentId: action.slice(6) });
    return;
  }
  if (action.startsWith("task:")) {
    setState({ screen: "taskDetail", taskId: action.slice(5) });
    return;
  }
  if (action.startsWith("stat:")) {
    setState({ fStatus: action.slice(5) });
    return;
  }
  if (action.startsWith("win:")) {
    setState({ fWinner: action.slice(4) });
    return;
  }
  switch (action) {
    case "dismissIntro":
      dismissIntro();
      break;
    case "startHero":
      startAuction(defaultLiveTask());
      break;
    case "restartAuction":
      startAuction(defaultLiveTask());
      break;
    case "newRandomAuction":
      startAuction(
        genAuction("Cluster 4,000 product reviews into themes and label each", "frontier"),
      );
      break;
    case "loadExample":
      loadExample();
      break;
    case "submitTask":
      submitTask();
      break;
    case "saveSettings":
      showToast("Settings saved");
      break;
    default:
      break;
  }
}

function onAppClick(event) {
  // The "Live Auction" nav item starts the auction rather than just navigating.
  const liveNav = event.target.closest("#nav-live");
  if (liveNav) {
    startAuction(state.livePhase === "idle" ? defaultLiveTask() : state.liveTask);
    return;
  }
  const el = event.target.closest("[data-action]");
  if (!el) return;
  handleAction(el.dataset.action);
}

function onFieldInput(event) {
  const el = event.target.closest("[data-field]");
  if (!el) return;
  const field = el.dataset.field;
  switch (field) {
    case "prompt": {
      const hadError = !!state.formError;
      state.form.prompt = el.value;
      if (hadError) setState({ formError: "" });
      break;
    }
    case "minTier":
      state.form.minTier = el.value;
      break;
    case "callback":
      state.form.callback = el.value;
      break;
    case "query":
      setState({ query: el.value });
      break;
    case "apiBase":
      state.settings.apiBase = el.value;
      break;
    case "poll":
      state.settings.poll = el.value;
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  try {
    if (localStorage.getItem("at_intro_dismissed") === "1") state.intro = false;
  } catch {
    /* storage unavailable */
  }

  buildShell();
  const app = document.querySelector("#app");
  app.addEventListener("click", onAppClick);
  const content = document.querySelector("#screen-content");
  content.addEventListener("input", onFieldInput);
  content.addEventListener("change", onFieldInput);

  updateChrome();
  renderScreen();
  renderToast();
}

init();

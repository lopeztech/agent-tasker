import { Hono } from "hono";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importPKCS8,
  type JWK,
} from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTaskTokenVerifier } from "@agent-tasker/agent";
import { COORDINATOR_ISSUER, TOKEN_TTL_SECONDS, type JwtPhase } from "@agent-tasker/protocol";
import { createApp } from "../src/app.js";
import type { GaepRuntimeClient } from "../src/runtime.js";

const KID = "test-kid";
const AUDIENCE = "gcp-orchestrator" as const;

let privateKeyPem: string;
let publicJwk: JWK;
let app: Hono;
let executeCalls = 0;

async function token(opts: {
  taskId?: string;
  phase?: JwtPhase;
  audience?: string;
  now?: Date;
}): Promise<string> {
  const key = await importPKCS8(privateKeyPem, "RS256");
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  return new SignJWT({
    task_id: opts.taskId ?? "task-1",
    phase: opts.phase ?? "bid",
  })
    .setProtectedHeader({ alg: "RS256", kid: KID, typ: "JWT" })
    .setIssuer(COORDINATOR_ISSUER)
    .setSubject(COORDINATOR_ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + TOKEN_TTL_SECONDS)
    .sign(key);
}

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  privateKeyPem = await exportPKCS8(privateKey);
  publicJwk = await exportJWK(publicKey);
  publicJwk.kid = KID;
});

beforeEach(() => {
  executeCalls = 0;
  const verifier = createTaskTokenVerifier({
    getKey: createLocalJWKSet({ keys: [publicJwk] }),
    expectedAudience: AUDIENCE,
  });
  const runtime: GaepRuntimeClient = {
    async execute(req) {
      executeCalls += 1;
      return {
        output: `orchestrated: ${req.spec.prompt}`,
        input_tokens: 7000,
        output_tokens: 1200,
      };
    },
  };
  app = createApp({ verifier, runtime });
});

describe("GET /health", () => {
  it("returns ok without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, agent_id: "gcp-orchestrator" });
  });
});

describe("POST /bid", () => {
  it("returns no_bid until the orchestrator estimator lands", async () => {
    const t = await token({ taskId: "task-bid-1", phase: "bid" });
    const res = await app.request("/bid", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
      body: JSON.stringify({ task_id: "task-bid-1", spec: { prompt: "plan work" } }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      task_id: "task-bid-1",
      agent_id: "gcp-orchestrator",
      status: "no_bid",
      reason: "capability",
    });
  });

  it("rejects missing bearer with 401", async () => {
    const res = await app.request("/bid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: "task-1", spec: { prompt: "x" } }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects execute-phase token on /bid with 401", async () => {
    const t = await token({ phase: "execute" });
    const res = await app.request("/bid", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
      body: JSON.stringify({ task_id: "task-1", spec: { prompt: "x" } }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /execute", () => {
  it("routes valid execute requests into the GAEP runtime adapter", async () => {
    const t = await token({ taskId: "task-exec-1", phase: "execute" });
    const res = await app.request("/execute", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
      body: JSON.stringify({ task_id: "task-exec-1", spec: { prompt: "do the thing" } }),
    });

    expect(res.status).toBe(200);
    expect(executeCalls).toBe(1);
    expect(await res.json()).toEqual({
      task_id: "task-exec-1",
      agent_id: "gcp-orchestrator",
      output: "orchestrated: do the thing",
      actual_usage: { input_tokens: 7000, output_tokens: 1200 },
    });
  });

  it("rejects bid-phase token on /execute with 401", async () => {
    const t = await token({ phase: "bid" });
    const res = await app.request("/execute", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
      body: JSON.stringify({ task_id: "task-1", spec: { prompt: "x" } }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects mismatched task_id between JWT and body with 401", async () => {
    const t = await token({ taskId: "task-token", phase: "execute" });
    const res = await app.request("/execute", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
      body: JSON.stringify({ task_id: "task-different", spec: { prompt: "x" } }),
    });
    expect(res.status).toBe(401);
    expect(executeCalls).toBe(0);
  });

  it("returns 400 on malformed body", async () => {
    const t = await token({ phase: "execute" });
    const res = await app.request("/execute", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
      body: JSON.stringify({ task_id: "task-1" }),
    });
    expect(res.status).toBe(400);
    expect(executeCalls).toBe(0);
  });
});

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
import {
  COORDINATOR_ISSUER,
  FALLBACK_PRICING,
  TOKEN_TTL_SECONDS,
  type JwtPhase,
} from "@agent-tasker/protocol";
import { createApp } from "../src/app.js";
import type { BidEstimator } from "../src/bid/estimator.js";

const KID = "test-kid";
const AUDIENCE = "azure-gpt" as const;

let privateKeyPem: string;
let publicJwk: JWK;
let app: Hono;

const stubEstimator: BidEstimator = {
  async estimate() {
    return { input_tokens: 4000, output_tokens: 1000 };
  },
};

const PRICING = FALLBACK_PRICING["gpt-5"]!;

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
  const verifier = createTaskTokenVerifier({
    getKey: createLocalJWKSet({ keys: [publicJwk] }),
    expectedAudience: AUDIENCE,
  });
  app = createApp({ verifier, estimator: stubEstimator, pricing: PRICING });
});

describe("GET /health", () => {
  it("returns ok without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, agent_id: "azure-gpt" });
  });
});

describe("POST /bid", () => {
  it("returns a Bid for a valid request", async () => {
    const t = await token({ taskId: "task-bid-1", phase: "bid" });
    const res = await app.request("/bid", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
      body: JSON.stringify({ task_id: "task-bid-1", spec: { prompt: "summarize" } }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agent_id: string;
      bid_usd: number;
      tier: string;
      model_family: string;
      model_id: string;
    };
    expect(body.agent_id).toBe("azure-gpt");
    expect(body.tier).toBe("frontier");
    expect(body.model_family).toBe("gpt");
    expect(body.model_id).toBe("gpt-5");
    expect(body.bid_usd).toBeGreaterThan(0);
  });

  it("rejects missing bearer with 401", async () => {
    const res = await app.request("/bid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: "task-1", spec: { prompt: "x" } }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects wrong phase with 401", async () => {
    const t = await token({ phase: "execute" });
    const res = await app.request("/bid", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
      body: JSON.stringify({ task_id: "task-1", spec: { prompt: "x" } }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects mismatched task_id between JWT and body with 401", async () => {
    const t = await token({ taskId: "task-token", phase: "bid" });
    const res = await app.request("/bid", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
      body: JSON.stringify({ task_id: "task-different", spec: { prompt: "x" } }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 on malformed body", async () => {
    const t = await token({ phase: "bid" });
    const res = await app.request("/bid", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
      body: JSON.stringify({ task_id: "task-1" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /execute", () => {
  it("verifies a valid execute token before returning not implemented", async () => {
    const t = await token({ taskId: "task-exec-1", phase: "execute" });
    const res = await app.request("/execute", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
      body: JSON.stringify({ task_id: "task-exec-1", spec: { prompt: "do the thing" } }),
    });

    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({
      error: {
        code: "not_implemented",
        message: "azure-gpt execute handler is not implemented yet",
      },
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
});

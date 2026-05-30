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
import type { GenerativeTextClient } from "../src/execute/runner.js";

const KID = "test-kid";
const AUDIENCE = "aws-nova" as const;

let privateKeyPem: string;
let publicJwk: JWK;

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

const stubEstimator: BidEstimator = {
  async estimate() {
    return { input_tokens: 2000, output_tokens: 500 };
  },
};

const stubClient: GenerativeTextClient = {
  async generate(prompt) {
    return {
      output: `nova result: ${prompt.slice(0, 20)}`,
      input_tokens: 2100,
      output_tokens: 480,
    };
  },
};

const pricing = FALLBACK_PRICING["amazon.nova-pro"]!;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  privateKeyPem = await exportPKCS8(privateKey);
  publicJwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256" };
});

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const verifier = createTaskTokenVerifier({
    getKey: createLocalJWKSet({ keys: [publicJwk] }),
    expectedAudience: AUDIENCE,
  });
  app = createApp({ verifier, estimator: stubEstimator, client: stubClient, pricing });
});

describe("GET /health", () => {
  it("returns ok without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, agent_id: "aws-nova" });
  });
});

describe("POST /bid", () => {
  it("returns a bid with a valid token", async () => {
    const jwt = await token({ phase: "bid", taskId: "task-1" });
    const res = await app.request("/bid", {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ task_id: "task-1", spec: { prompt: "Summarize this" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["agent_id"]).toBe("aws-nova");
    expect(body["tier"]).toBe("frontier");
    expect(typeof body["bid_usd"]).toBe("number");
  });

  it("rejects missing token", async () => {
    const res = await app.request("/bid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: "task-1", spec: { prompt: "x" } }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects wrong phase", async () => {
    const jwt = await token({ phase: "execute", taskId: "task-1" });
    const res = await app.request("/bid", {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ task_id: "task-1", spec: { prompt: "x" } }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects mismatched task_id", async () => {
    const jwt = await token({ phase: "bid", taskId: "task-A" });
    const res = await app.request("/bid", {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ task_id: "task-B", spec: { prompt: "x" } }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /execute", () => {
  it("returns a result with a valid token", async () => {
    const jwt = await token({ phase: "execute", taskId: "task-1" });
    const res = await app.request("/execute", {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ task_id: "task-1", spec: { prompt: "Do the thing" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["agent_id"]).toBe("aws-nova");
    expect(typeof body["output"]).toBe("string");
  });
});

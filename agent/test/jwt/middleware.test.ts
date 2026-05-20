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
import { beforeAll, describe, expect, it } from "vitest";
import { COORDINATOR_ISSUER, TOKEN_TTL_SECONDS } from "@agent-tasker/protocol";
import { getTokenClaims, requireTaskToken } from "../../src/jwt/middleware.js";
import { createTaskTokenVerifier } from "../../src/jwt/verify.js";

const KID = "test-kid";
const AUDIENCE = "gcp-gemini" as const;

let privateKeyPem: string;
let publicJwk: JWK;
let app: Hono;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  privateKeyPem = await exportPKCS8(privateKey);
  publicJwk = await exportJWK(publicKey);
  publicJwk.kid = KID;

  const verifier = createTaskTokenVerifier({
    getKey: createLocalJWKSet({ keys: [publicJwk] }),
    expectedAudience: AUDIENCE,
  });

  app = new Hono();
  app.post("/bid", requireTaskToken(verifier, "bid"), (c) => {
    const claims = getTokenClaims(c);
    return c.json({ ok: true, task_id: claims.task_id, phase: claims.phase });
  });
});

async function bearerToken(opts: { phase?: string; audience?: string } = {}): Promise<string> {
  const key = await importPKCS8(privateKeyPem, "RS256");
  const iat = Math.floor(Date.now() / 1000);
  return new SignJWT({ task_id: "task-mw-1", phase: opts.phase ?? "bid" })
    .setProtectedHeader({ alg: "RS256", kid: KID, typ: "JWT" })
    .setIssuer(COORDINATOR_ISSUER)
    .setSubject(COORDINATOR_ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + TOKEN_TTL_SECONDS)
    .sign(key);
}

describe("requireTaskToken middleware", () => {
  it("calls the downstream handler with claims attached on success", async () => {
    const token = await bearerToken();
    const res = await app.request("/bid", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; task_id: string; phase: string };
    expect(body).toEqual({ ok: true, task_id: "task-mw-1", phase: "bid" });
  });

  it("returns 401 when no Authorization header is present", async () => {
    const res = await app.request("/bid", { method: "POST" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.message).toMatch(/missing bearer/i);
  });

  it("returns 401 when the Authorization header isn't a bearer", async () => {
    const res = await app.request("/bid", {
      method: "POST",
      headers: { authorization: "Basic Zm9vOmJhcg==" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token's phase doesn't match the route's expected phase", async () => {
    const token = await bearerToken({ phase: "award" });
    const res = await app.request("/bid", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/expected phase bid/i);
  });

  it("returns 401 when the audience doesn't match", async () => {
    const token = await bearerToken({ audience: "aws-nova" });
    const res = await app.request("/bid", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });
});

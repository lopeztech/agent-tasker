import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importPKCS8,
  type JWK,
} from "jose";
import { COORDINATOR_ISSUER, TOKEN_TTL_SECONDS } from "@agent-tasker/protocol";
import {
  TokenVerificationError,
  createTaskTokenVerifier,
  type TaskTokenVerifier,
} from "../../src/jwt/verify.js";

const KID = "test-coordinator-1";
const AUDIENCE = "gcp-gemini" as const;

let privateKeyPem: string;
let publicJwk: JWK;
let verifier: TaskTokenVerifier;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  privateKeyPem = await exportPKCS8(privateKey);
  publicJwk = await exportJWK(publicKey);
  publicJwk.kid = KID;
  verifier = createTaskTokenVerifier({
    getKey: createLocalJWKSet({ keys: [publicJwk] }),
    expectedAudience: AUDIENCE,
  });
});

afterAll(() => {
  // No resources to release; left for symmetry as more setup creeps in.
});

interface SignOptions {
  audience?: string;
  iss?: string;
  sub?: string;
  taskId?: string;
  phase?: string;
  ttlSeconds?: number;
  now?: Date;
  // Override the kid header (default: KID).
  kid?: string;
}

async function mintToken(opts: SignOptions = {}): Promise<string> {
  const key = await importPKCS8(privateKeyPem, "RS256");
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const ttl = opts.ttlSeconds ?? TOKEN_TTL_SECONDS;
  return new SignJWT({
    task_id: opts.taskId ?? "task-1",
    phase: opts.phase ?? "bid",
  })
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? KID, typ: "JWT" })
    .setIssuer(opts.iss ?? COORDINATOR_ISSUER)
    .setSubject(opts.sub ?? COORDINATOR_ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttl)
    .sign(key);
}

describe("createTaskTokenVerifier", () => {
  it("returns parsed claims for a well-formed token signed by the trusted key", async () => {
    const token = await mintToken();
    const claims = await verifier.verify(token, "bid");
    expect(claims.task_id).toBe("task-1");
    expect(claims.phase).toBe("bid");
    expect(claims.aud).toBe(AUDIENCE);
    expect(claims.iss).toBe(COORDINATOR_ISSUER);
    expect(claims.sub).toBe(COORDINATOR_ISSUER);
  });

  it("rejects when the expected phase doesn't match the claim", async () => {
    const token = await mintToken({ phase: "bid" });
    await expect(verifier.verify(token, "award")).rejects.toThrow(TokenVerificationError);
    await expect(verifier.verify(token, "award")).rejects.toThrow(/expected phase award/i);
  });

  it("rejects on wrong audience", async () => {
    const token = await mintToken({ audience: "aws-nova" });
    await expect(verifier.verify(token, "bid")).rejects.toThrow(TokenVerificationError);
  });

  it("rejects on wrong issuer", async () => {
    const token = await mintToken({ iss: "evil-coordinator" });
    await expect(verifier.verify(token, "bid")).rejects.toThrow(TokenVerificationError);
  });

  it("rejects expired tokens", async () => {
    const past = new Date(Date.now() - 120_000);
    const token = await mintToken({ now: past });
    await expect(verifier.verify(token, "bid")).rejects.toThrow(TokenVerificationError);
  });

  it("rejects tokens signed by an untrusted key (wrong kid → JWKS miss)", async () => {
    // Generate a *different* keypair; sign with that key but claim the trusted kid.
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const otherPem = await exportPKCS8(privateKey);
    const otherKey = await importPKCS8(otherPem, "RS256");
    const iat = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ task_id: "task-bad", phase: "bid" })
      .setProtectedHeader({ alg: "RS256", kid: "untrusted-kid", typ: "JWT" })
      .setIssuer(COORDINATOR_ISSUER)
      .setSubject(COORDINATOR_ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(iat + TOKEN_TTL_SECONDS)
      .sign(otherKey);
    await expect(verifier.verify(token, "bid")).rejects.toThrow(TokenVerificationError);
  });

  it("rejects tokens whose claims fail Zod schema parsing", async () => {
    // phase is required + must be one of the JwtPhase enum values.
    const token = await mintToken({ phase: "not-a-real-phase" });
    await expect(verifier.verify(token, "bid")).rejects.toThrow(TokenVerificationError);
  });
});

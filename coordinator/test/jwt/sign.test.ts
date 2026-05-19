import { describe, it, expect, beforeAll } from "vitest";
import { exportJWK, exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import {
  COORDINATOR_ISSUER,
  TOKEN_TTL_SECONDS,
  TaskTokenClaimsSchema,
} from "@agent-tasker/protocol";
import { StaticKeyProvider, signTaskToken, type SigningKey } from "../../src/jwt/index.js";

const KID = "test-kid-1";

let provider: StaticKeyProvider;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const privateKeyPem = await exportPKCS8(privateKey);
  publicJwk = await exportJWK(publicKey);
  const key: SigningKey = { kid: KID, privateKeyPem };
  provider = new StaticKeyProvider(key);
});

// Helper: verify a coordinator-minted token end-to-end and return the parsed claims.
async function verify(jwt: string, audience: string) {
  const { payload, protectedHeader } = await jwtVerify(jwt, publicJwk, {
    issuer: COORDINATOR_ISSUER,
    audience,
    algorithms: ["RS256"],
  });
  return { payload, protectedHeader };
}

describe("signTaskToken", () => {
  it("produces a token that verifies under the matching public key", async () => {
    const jwt = await signTaskToken(provider, {
      agentId: "gcp-gemini",
      taskId: "task-abc",
      phase: "bid",
    });

    const { payload, protectedHeader } = await verify(jwt, "gcp-gemini");

    expect(protectedHeader.alg).toBe("RS256");
    expect(protectedHeader.kid).toBe(KID);
    expect(protectedHeader.typ).toBe("JWT");

    const parsed = TaskTokenClaimsSchema.parse(payload);
    expect(parsed.iss).toBe(COORDINATOR_ISSUER);
    expect(parsed.sub).toBe(COORDINATOR_ISSUER);
    expect(parsed.aud).toBe("gcp-gemini");
    expect(parsed.task_id).toBe("task-abc");
    expect(parsed.phase).toBe("bid");
    expect(parsed.exp - parsed.iat).toBe(TOKEN_TTL_SECONDS);
  });

  it("rejects verification when the audience doesn't match", async () => {
    const jwt = await signTaskToken(provider, {
      agentId: "gcp-gemini",
      taskId: "task-abc",
      phase: "bid",
    });

    await expect(verify(jwt, "aws-nova")).rejects.toThrow(/aud/i);
  });

  it("respects a custom ttlSeconds", async () => {
    const jwt = await signTaskToken(provider, {
      agentId: "azure-gpt",
      taskId: "task-xyz",
      phase: "execute",
      ttlSeconds: 300,
    });

    const { payload } = await verify(jwt, "azure-gpt");
    const parsed = TaskTokenClaimsSchema.parse(payload);
    expect(parsed.exp - parsed.iat).toBe(300);
  });

  it("uses the injected clock for iat/exp", async () => {
    const fixed = new Date("2026-05-20T12:00:00Z");
    const jwt = await signTaskToken(provider, {
      agentId: "gcp-orchestrator",
      taskId: "task-clock",
      phase: "award",
      now: () => fixed,
    });

    // Decode without time validation so we can read iat exactly. The default
    // jwtVerify would compare exp to system time; use a "currentDate" override
    // matching the fixed clock so the token isn't seen as expired.
    const { payload } = await jwtVerify(jwt, publicJwk, {
      issuer: COORDINATOR_ISSUER,
      audience: "gcp-orchestrator",
      algorithms: ["RS256"],
      currentDate: fixed,
    });
    const parsed = TaskTokenClaimsSchema.parse(payload);
    expect(parsed.iat).toBe(Math.floor(fixed.getTime() / 1000));
    expect(parsed.exp).toBe(parsed.iat + TOKEN_TTL_SECONDS);
  });

  it("is rejected after exp has passed", async () => {
    // Sign with a clock 2 minutes in the past so the 60s token is now expired.
    const past = new Date(Date.now() - 120_000);
    const jwt = await signTaskToken(provider, {
      agentId: "gcp-gemini",
      taskId: "task-expired",
      phase: "bid",
      now: () => past,
    });

    await expect(verify(jwt, "gcp-gemini")).rejects.toThrow(/exp.*timestamp/i);
  });

  it("embeds the kid header so JWKS rotation can route to the right public key", async () => {
    const jwt = await signTaskToken(provider, {
      agentId: "gcp-gemini",
      taskId: "task-kid",
      phase: "reject",
    });

    const { protectedHeader } = await verify(jwt, "gcp-gemini");
    expect(protectedHeader.kid).toBe(KID);
  });
});

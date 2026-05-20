import { jwtVerify, type JWTVerifyGetKey } from "jose";
import {
  COORDINATOR_ISSUER,
  TaskTokenClaimsSchema,
  type AgentId,
  type JwtPhase,
  type TaskTokenClaims,
} from "@agent-tasker/protocol";

// Production wiring uses `createRemoteJWKSet(new URL(JWKS_URL), { cacheMaxAge })`
// from `jose` for `getKey` — that handles JWKS fetch + caching + transparent
// key rotation. Tests pass `createLocalJWKSet(...)` against an in-memory
// keypair so they don't need a fake JWKS HTTP server.
export interface TaskTokenVerifierOptions {
  getKey: JWTVerifyGetKey;
  expectedAudience: AgentId;
  // Seconds of clock skew the verifier tolerates either side of `exp` / `iat`.
  // Defaults to 5; production deploys can crank this down once clock sync is
  // measured.
  clockTolerance?: number;
}

export interface TaskTokenVerifier {
  verify(token: string, expectedPhase: JwtPhase): Promise<TaskTokenClaims>;
}

// Thrown for every recoverable token-verification failure (bad signature,
// wrong audience, wrong phase, expired, malformed claims). Callers can
// catch this class once instead of branching on jose error subclasses.
export class TokenVerificationError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TokenVerificationError";
    if (cause !== undefined) this.cause = cause;
  }
}

export function createTaskTokenVerifier(opts: TaskTokenVerifierOptions): TaskTokenVerifier {
  return {
    async verify(token, expectedPhase) {
      let payload: unknown;
      try {
        const result = await jwtVerify(token, opts.getKey, {
          issuer: COORDINATOR_ISSUER,
          audience: opts.expectedAudience,
          algorithms: ["RS256"],
          clockTolerance: opts.clockTolerance ?? 5,
        });
        payload = result.payload;
      } catch (err) {
        throw new TokenVerificationError(`jwt verification failed: ${(err as Error).message}`, err);
      }

      const parsed = TaskTokenClaimsSchema.safeParse(payload);
      if (!parsed.success) {
        throw new TokenVerificationError(
          `token claims do not match schema: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")}`,
        );
      }

      if (parsed.data.phase !== expectedPhase) {
        throw new TokenVerificationError(
          `expected phase ${expectedPhase}, got ${parsed.data.phase}`,
        );
      }

      return parsed.data;
    },
  };
}

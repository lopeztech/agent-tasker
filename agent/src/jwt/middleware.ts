import type { Context, Next } from "hono";
import type { JwtPhase, TaskTokenClaims } from "@agent-tasker/protocol";
import { TokenVerificationError, type TaskTokenVerifier } from "./verify.js";

// Key under which verified claims are attached to Hono's context. Handlers
// read via `getTokenClaims(c)` so the consumer never types this string.
export const TOKEN_CLAIMS_CONTEXT_KEY = "__taskTokenClaims";

// Hono middleware factory. Returns a middleware that rejects requests
// missing or failing JWT verification with a structured 401, and on
// success attaches the parsed claims to the Hono context.
//
// Usage in an agent's `/bid` handler:
//
//   app.post("/bid",
//     requireTaskToken(verifier, "bid"),
//     async (c) => { const claims = getTokenClaims(c); ... });
export function requireTaskToken(verifier: TaskTokenVerifier, expectedPhase: JwtPhase) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.req.header("authorization") ?? c.req.header("Authorization");
    if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
      return c.json({ error: { code: "unauthorized", message: "missing bearer token" } }, 401);
    }
    const token = auth.slice("bearer ".length).trim();
    try {
      const claims = await verifier.verify(token, expectedPhase);
      c.set(TOKEN_CLAIMS_CONTEXT_KEY, claims);
    } catch (err) {
      const message =
        err instanceof TokenVerificationError ? err.message : "token verification failed";
      return c.json({ error: { code: "unauthorized", message } }, 401);
    }
    await next();
  };
}

// Read verified claims set by `requireTaskToken` upstream. Throws if the
// middleware wasn't wired — that's a programmer error, not a runtime
// concern, so no graceful fallback.
export function getTokenClaims(c: Context): TaskTokenClaims {
  const claims = c.get(TOKEN_CLAIMS_CONTEXT_KEY) as TaskTokenClaims | undefined;
  if (!claims) {
    throw new Error(
      "getTokenClaims called without requireTaskToken middleware upstream of the handler",
    );
  }
  return claims;
}

import { SignJWT, importPKCS8 } from "jose";
import {
  COORDINATOR_ISSUER,
  TOKEN_TTL_SECONDS,
  type AgentId,
  type JwtPhase,
  type TaskId,
} from "@agent-tasker/protocol";
import type { KeyProvider } from "./keys.js";

export interface SignTaskTokenArgs {
  agentId: AgentId;
  taskId: TaskId;
  phase: JwtPhase;
  // Override per-call when the auction needs a tighter window than the
  // default 60s. Pass through directly; no clock-skew padding is added —
  // verifiers handle that.
  ttlSeconds?: number;
  // Hook for deterministic test clocks. Defaults to `new Date()`.
  now?: () => Date;
}

// Mint a single-use, single-phase task token. Each call to `/announce`,
// `/award`, `/execute`, `/reject` should mint a fresh token; tokens are
// scoped to one (task, agent, phase) tuple.
export async function signTaskToken(
  keyProvider: KeyProvider,
  args: SignTaskTokenArgs,
): Promise<string> {
  const key = await keyProvider.getActiveKey();
  const privateKey = await importPKCS8(key.privateKeyPem, "RS256");
  const issuedAt = Math.floor((args.now?.() ?? new Date()).getTime() / 1000);
  const ttl = args.ttlSeconds ?? TOKEN_TTL_SECONDS;

  return new SignJWT({
    task_id: args.taskId,
    phase: args.phase,
  })
    .setProtectedHeader({ alg: "RS256", kid: key.kid, typ: "JWT" })
    .setIssuer(COORDINATOR_ISSUER)
    .setSubject(COORDINATOR_ISSUER)
    .setAudience(args.agentId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttl)
    .sign(privateKey);
}

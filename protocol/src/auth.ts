import { z } from "zod";
import { AgentIdSchema } from "./agents.js";
import { TaskIdSchema, JwtPhaseSchema } from "./schemas.js";

// Standard values for coordinator-minted JWTs. See CLAUDE.md →
// Coordinator → agent auth (signed JWT).
export const COORDINATOR_ISSUER = "agent-tasker-coordinator";
export const TOKEN_TTL_SECONDS = 60;

// Decoded JWT payload an agent observes after verification. Standard
// RFC 7519 claims (iss/sub/aud/exp/iat) plus agent-tasker-specific
// (task_id, phase). Used by both the signer (to assemble) and the
// per-agent verifier middleware (to validate after JWKS lookup).
export const TaskTokenClaimsSchema = z.object({
  iss: z.literal(COORDINATOR_ISSUER),
  sub: z.literal(COORDINATOR_ISSUER),
  aud: AgentIdSchema,
  exp: z.number().int().positive(),
  iat: z.number().int().positive(),
  task_id: TaskIdSchema,
  phase: JwtPhaseSchema,
});
export type TaskTokenClaims = z.infer<typeof TaskTokenClaimsSchema>;

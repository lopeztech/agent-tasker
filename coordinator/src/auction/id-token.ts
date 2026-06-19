// Google OIDC ID-token provider for coordinator → agent calls.
//
// When a GCP agent's Cloud Run service is locked to coordinator-only
// invocation (`roles/run.invoker` granted only to the coordinator SA), the
// coordinator must present a Google-signed ID token so Cloud Run's IAM check
// passes. We send that token in the `X-Serverless-Authorization` header — Cloud
// Run validates it there and leaves the `Authorization` header (which carries
// the per-task RS256 JWT the agent verifies) untouched for the container. That
// avoids moving the task JWT off `Authorization` and keeps the agent-side auth
// unchanged.
//
// Tokens are fetched from the GCP metadata server, which mints an ID token for
// the coordinator's runtime service account with `aud` set to the receiving
// service's URL. No extra dependency or IAM grant is needed — every Cloud Run
// instance can mint identity tokens for its own service account.

export type IdTokenProvider = (audience: string) => Promise<string | undefined>;

const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

// Refresh a little before the ~1h metadata-server token lifetime so a cached
// token never expires mid-flight on a slow auction.
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const ASSUMED_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

export interface MetadataIdTokenProviderOptions {
  // Override for tests; defaults to the global `fetch`.
  fetch?: typeof fetch;
  // Override the clock for tests.
  now?: () => number;
}

// Builds an IdTokenProvider backed by the GCP metadata server, caching one
// token per audience until shortly before it expires. Decodes the JWT `exp`
// claim to size the cache window; falls back to a conservative assumed lifetime
// if the token can't be parsed.
export function createMetadataIdTokenProvider(
  options: MetadataIdTokenProviderOptions = {},
): IdTokenProvider {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CachedToken>();

  return async (audience: string): Promise<string | undefined> => {
    const cached = cache.get(audience);
    if (cached && cached.expiresAtMs - TOKEN_REFRESH_SKEW_MS > now()) {
      return cached.token;
    }

    const url = `${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(audience)}&format=full`;
    const res = await fetchImpl(url, { headers: { "Metadata-Flavor": "Google" } });
    if (!res.ok) {
      throw new Error(`metadata identity fetch failed: ${res.status}`);
    }
    const token = (await res.text()).trim();
    cache.set(audience, { token, expiresAtMs: tokenExpiryMs(token, now) });
    return token;
  };
}

// Reads the `exp` claim (seconds since epoch) from a JWT without verifying it —
// we only use it to decide when to refresh our own cache. Returns a conservative
// fallback if the token is unparseable.
function tokenExpiryMs(token: string, now: () => number): number {
  const fallback = now() + ASSUMED_TOKEN_LIFETIME_MS;
  const parts = token.split(".");
  if (parts.length < 2) return fallback;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof payload.exp === "number" ? payload.exp * 1000 : fallback;
  } catch {
    return fallback;
  }
}

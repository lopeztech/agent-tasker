import { describe, expect, it, vi } from "vitest";
import { createMetadataIdTokenProvider } from "../../src/auction/id-token.js";

// Builds a JWT-shaped string whose payload carries the given `exp` (seconds).
// The provider only base64url-decodes the payload to size its cache; the
// signature is irrelevant here.
function tokenWithExp(expSeconds: number, marker = "tok"): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds, marker })).toString("base64url");
  return `${header}.${payload}.sig-${marker}`;
}

const AUDIENCE = "https://agent.example.run.app";

describe("createMetadataIdTokenProvider", () => {
  it("requests an ID token from the metadata server for the given audience", async () => {
    const now = 1_000_000;
    const fetchImpl = vi.fn(
      async () => new Response(tokenWithExp(now / 1000 + 3600), { status: 200 }),
    );

    const provider = createMetadataIdTokenProvider({
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });
    const token = await provider(AUDIENCE);

    expect(token).toBe(tokenWithExp(now / 1000 + 3600));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain("metadata.google.internal");
    expect(url).toContain(`audience=${encodeURIComponent(AUDIENCE)}`);
    expect((init as RequestInit).headers).toMatchObject({ "Metadata-Flavor": "Google" });
  });

  it("caches the token per audience until shortly before expiry", async () => {
    let now = 1_000_000;
    const expSeconds = now / 1000 + 3600; // expires in 1h
    const fetchImpl = vi.fn(async () => new Response(tokenWithExp(expSeconds), { status: 200 }));
    const provider = createMetadataIdTokenProvider({
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });

    await provider(AUDIENCE);
    now += 30 * 60 * 1000; // +30m, still well before expiry
    await provider(AUDIENCE);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // served from cache

    // Past expiry minus the refresh skew → refetch.
    now += 30 * 60 * 1000; // now at the 1h mark
    await provider(AUDIENCE);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps separate cache entries per audience", async () => {
    const now = 1_000_000;
    const fetchImpl = vi.fn(
      async () => new Response(tokenWithExp(now / 1000 + 3600), { status: 200 }),
    );
    const provider = createMetadataIdTokenProvider({
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });

    await provider("https://a.run.app");
    await provider("https://b.run.app");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws when the metadata server returns a non-200", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    const provider = createMetadataIdTokenProvider({
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider(AUDIENCE)).rejects.toThrow(/metadata identity fetch failed: 503/);
  });
});

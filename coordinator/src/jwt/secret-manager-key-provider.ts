import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import type { KeyProvider, SigningKey } from "./keys.js";

// Reads the active signing key from a Secret Manager secret. The secret
// payload is JSON: { kid: string, privateKeyPem: string }. Cache lasts for
// `cacheTtlMs` (default 1h) to avoid hitting the Secret Manager API on every
// request — the active key changes only during rotation.
export class SecretManagerKeyProvider implements KeyProvider {
  private cached: { key: SigningKey; expiresAt: number } | null = null;

  constructor(
    private readonly secretName: string, // full resource name: projects/P/secrets/S/versions/latest
    private readonly client: SecretManagerServiceClient,
    private readonly cacheTtlMs = 3_600_000,
  ) {}

  async getActiveKey(): Promise<SigningKey> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.key;
    }

    const [version] = await this.client.accessSecretVersion({ name: this.secretName });
    const payload = version.payload?.data;
    if (!payload) throw new Error(`Secret ${this.secretName} has empty payload`);
    const text = typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8");
    const parsed = JSON.parse(text) as { kid: string; privateKeyPem: string };

    if (!parsed.kid || !parsed.privateKeyPem) {
      throw new Error(`Secret ${this.secretName} missing kid or privateKeyPem`);
    }

    const key: SigningKey = { kid: parsed.kid, privateKeyPem: parsed.privateKeyPem };
    this.cached = { key, expiresAt: now + this.cacheTtlMs };
    return key;
  }
}

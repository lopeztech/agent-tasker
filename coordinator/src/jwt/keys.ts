// A single coordinator signing key, identified by `kid` so it can be matched
// against the corresponding entry in the JWKS document agents fetch.
export interface SigningKey {
  kid: string;
  privateKeyPem: string;
}

// Abstract source of the currently-active signing key. Real production wiring
// pulls from Secret Manager (added with #21); tests and local dev use
// `StaticKeyProvider` to inject a key generated at startup.
//
// During a JWKS rotation window both old and new public keys are served from
// the JWKS endpoint, but `getActiveKey` returns only the currently-active
// signing key — only one key signs new tokens at any moment.
export interface KeyProvider {
  getActiveKey(): Promise<SigningKey>;
}

export class StaticKeyProvider implements KeyProvider {
  constructor(private readonly key: SigningKey) {}
  async getActiveKey(): Promise<SigningKey> {
    return this.key;
  }
}

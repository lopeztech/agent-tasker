#!/usr/bin/env node
// Generates an RS256 signing keypair, stores the private key in Secret Manager,
// and publishes the initial JWKS document to the GCS bucket.
//
// Run once per environment to bootstrap, then use the rotation flow described
// in infra/coordinator/jwks.tf for key rotation.
//
// Usage:
//   node coordinator/scripts/bootstrap-jwks.mjs \
//     --project=agent-tasker-lcd \
//     --bucket=agent-tasker-dev-jwks-agent-tasker-lcd \
//     --secret=agent-tasker-dev-coordinator-signing-key
//
// Requires Application Default Credentials with:
//   roles/secretmanager.admin (or secretVersionAdder on the secret)
//   roles/storage.objectAdmin on the JWKS bucket

import { generateKeyPair, createPublicKey } from "crypto";
import { promisify } from "util";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";

const generateKeyPairAsync = promisify(generateKeyPair);

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => a.slice(2).split("=")),
);

const { project, bucket, secret } = args;
if (!project || !bucket || !secret) {
  console.error("Usage: bootstrap-jwks.mjs --project=P --bucket=B --secret=S");
  process.exit(1);
}

async function main() {
  const kid = randomUUID();
  console.log(`Generating RS256 keypair (kid=${kid})...`);

  const { privateKey, publicKey } = await generateKeyPairAsync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Build JWKS from public key
  const jwk = createPublicKey(publicKey).export({ format: "jwk" });
  const jwks = {
    keys: [{ ...jwk, use: "sig", alg: "RS256", kid }],
  };

  // Store private key in Secret Manager
  const smClient = new SecretManagerServiceClient();
  const secretPath = `projects/${project}/secrets/${secret}`;

  // Create secret if it doesn't exist
  try {
    await smClient.createSecret({
      parent: `projects/${project}`,
      secretId: secret,
      secret: { replication: { automatic: {} } },
    });
    console.log(`Created Secret Manager secret: ${secret}`);
  } catch (err) {
    if (err.code === 6 /* ALREADY_EXISTS */) {
      console.log(`Secret Manager secret already exists: ${secret}`);
    } else {
      throw err;
    }
  }

  await smClient.addSecretVersion({
    parent: secretPath,
    payload: {
      data: Buffer.from(JSON.stringify({ kid, privateKeyPem: privateKey })),
    },
  });
  console.log(`Stored private key in Secret Manager: ${secret} (kid=${kid})`);

  // Upload JWKS to GCS
  const storage = new Storage({ projectId: project });
  const file = storage.bucket(bucket).file("jwks.json");
  await file.save(JSON.stringify(jwks, null, 2), {
    contentType: "application/json",
    metadata: {
      cacheControl: "public, max-age=3600",
    },
  });
  console.log(`Published JWKS to gs://${bucket}/jwks.json (kid=${kid})`);
  console.log(`\nJWKS URL: https://storage.googleapis.com/${bucket}/jwks.json`);
  console.log(`\nNext: update coordinator Cloud Run env var SIGNING_KEY_SECRET=${secret}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

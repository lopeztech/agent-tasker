# infra/operator-console

Hosts the operator console (the static "Market Terminal" SPA in
[`/operator-console`](../../operator-console)) on **Cloud Run**, fronted by a
**Cloud Run domain mapping** with a Google-managed TLS cert, with DNS in
**Cloudflare**.

```
 user ─▶ tasker.lopezcloud.dev
          │  Cloudflare DNS (CNAME, DNS-only/grey) → ghs.googlehosted.com
          ▼
        Cloud Run domain mapping (Google-managed cert)
          ▼
        Cloud Run service  (nginx, static files, scales to zero)
```

## Why this shape (vs. GCS + HTTPS LB + Cloud CDN)

The console is a tiny static bundle. Cloud Run + domain mapping reuses the
exact image-build → Artifact Registry → Cloud Run → Terraform pattern every
other service in this repo already uses, **scales to zero (~$0 idle)**, and
needs **no global external load balancer** (which would run ~$18–25/mo even
idle). The tradeoff is no edge CDN and a one-time domain-ownership
verification. If edge caching ever matters, promote to the
GCS-bucket + HTTPS LB + Cloud CDN path (see the comment in
`infra/coordinator/jwks.tf`) and switch the Cloudflare record to proxied.

Cloudflare is **DNS-only (grey cloud)** on purpose: Google must see the real
CNAME to `ghs.googlehosted.com` to validate the domain and issue/renew the
managed cert. Proxying here would break cert issuance and double-terminate TLS.

## One-time prerequisites

1. **Cloudflare API token** — create a token scoped to `Zone:DNS:Edit` +
   `Zone:Read` on the `lopezcloud.dev` zone. Add it as the GitHub Actions
   secret **`CLOUDFLARE_API_TOKEN`** (CI passes it as
   `TF_VAR_cloudflare_api_token`). The operator-console build + deploy steps in
   CI are gated on this secret being present, so until it's set the rest of the
   pipeline is unaffected.

2. **Domain-ownership verification** (required by Cloud Run domain mapping):

   ```sh
   gcloud domains verify lopezcloud.dev
   ```

   This prints a TXT record — add it in Cloudflare, then confirm. Also add the
   **CI/CD deploy service account** (`cicd_service_account_email` output from
   `infra/project`) as a verified owner of the property in
   [Search Console](https://search.google.com/search-console) so CI can create
   the mapping. Verification is per-account and only needs doing once.

3. **Bootstrap the module once** so the Artifact Registry repo exists before CI
   tries to push to it (same as the other modules):

   ```sh
   cd infra/operator-console
   terraform init -backend-config=backend.hcl
   terraform apply            # creates AR repo, SA, service (placeholder image),
                              # domain mapping, and the Cloudflare record
   ```

   On a fresh project, apply `infra/project` and `infra/coordinator` first —
   the latter restores the org policy that allows the public (`allUsers`)
   invoker binding used here.

## Day-to-day

CI (`.github/workflows/ci.yml`) builds `operator-console/Dockerfile`, pushes
to Artifact Registry, and runs `terraform apply` with the new image tag on
every push to `main` (when `CLOUDFLARE_API_TOKEN` is set).

## Outputs

- `console_custom_domain_url` — `https://tasker.lopezcloud.dev`
- `console_url` — the underlying `*.run.app` URL
- `console_image_repo` — Artifact Registry path CI pushes to
- `dns_record_target` — the CNAME to create if you set `manage_dns = false`

## Note: wiring the console to the live coordinator API

The console currently ships with mock data. When it's pointed at the real
coordinator (Settings → API base URL), the browser will call the coordinator
from `https://tasker.lopezcloud.dev`, a different origin than the coordinator's
`*.run.app` host — so the **coordinator must send CORS headers** allowing this
origin. That's a coordinator-side change, tracked separately from this module.

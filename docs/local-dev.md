# Local dev workflow

## Policy: real GCP, no emulators

We develop against a **real, dedicated GCP project** ("dev"), not LocalStack or the Firestore emulator. Reasons:

- The system spans Cloud Run, Firestore, Cloud Scheduler / Cloud Functions, GCS + Cloud CDN, Secret Manager, and (in later phases) Vertex AI / Gemini Enterprise Agent Platform. Emulators exist for some of these but not all, and the ones that exist drift from the real APIs.
- Vertex AI and GAEP have no usable local emulation. A mock here would lie about latency, quotas, and behavior.
- Phase 1's whole point is to surface real cost and latency dynamics. Mocked infra defeats that.
- A dev project at idle costs single-digit dollars/month (see CLAUDE.md → Cost model).

Use a **separate GCP project per environment** (e.g. `agent-tasker-dev`, `agent-tasker-prod`). Never share a project between you and CI/prod.

## Prerequisites

| Tool | Version | Why |
|-|-|-|
| Node | 22 (see `.nvmrc`) | Runtime for coordinator/agents |
| pnpm | ≥ 10 (see `packageManager`) | Workspace manager — `corepack enable` to install |
| Terraform | ≥ 1.7 | Provisions everything in `infra/` |
| gcloud | latest | Auth + bootstrap commands |

`corepack enable` is the easiest way to get the right pnpm version; it reads `packageManager` from `package.json`.

## One-time GCP setup (per dev environment)

1. **Create a project** in the GCP console and attach a billing account. Note the project ID.

2. **Authenticate locally** so Terraform can act as you:

   ```sh
   gcloud auth login
   gcloud auth application-default login
   gcloud config set project YOUR_PROJECT_ID
   ```

   `application-default login` writes ADC credentials that the Terraform google provider reads automatically.

3. **Create the Terraform state bucket** (chicken-and-egg: state lives in GCS, but the bucket is created out-of-band):

   ```sh
   gcloud storage buckets create gs://agent-tasker-tfstate-CHANGEME \
     --project=YOUR_PROJECT_ID --location=us-central1 \
     --uniform-bucket-level-access
   gcloud storage buckets update gs://agent-tasker-tfstate-CHANGEME --versioning
   ```

   GCS provides state locking natively via object generation — no separate lock table needed.

4. **Apply `infra/project`** to enable APIs and create the coordinator service account:

   ```sh
   cd infra/project
   cp backend.hcl.example backend.hcl  # then set bucket to the one you just made
   terraform init -backend-config=backend.hcl
   terraform apply -var project_id=YOUR_PROJECT_ID -var env=dev
   ```

   See `infra/project/backend.hcl.example` for the full bootstrap sequence with copy-pasteable commands.

## One-time repo setup

```sh
git clone https://github.com/lopeztech/agent-tasker.git
cd agent-tasker
corepack enable                    # if you don't already have pnpm
pnpm install                       # also runs `husky` via the prepare script
```

After `pnpm install`, the husky pre-commit hook is active: staged `.ts/.js` get `eslint --fix` then `prettier --write`; staged `.json/.yml` get `prettier --write`.

## Daily commands

All scripts run from the repo root:

| Command | What it does |
|-|-|
| `pnpm typecheck` | `tsc --noEmit` across every workspace (cached by Turbo) |
| `pnpm lint` | ESLint v9 flat config over the whole repo |
| `pnpm format` | Prettier check (CI runs this) |
| `pnpm format:write` | Prettier write (fix formatting) |
| `pnpm test` | `turbo run test` — no-op today; populated as test scripts land |
| `pnpm build` | `tsc` per workspace |
| `pnpm clean` | Remove `dist/`, `*.tsbuildinfo`, `node_modules/` |

CI (`.github/workflows/ci.yml`) runs `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`, and `terraform fmt -check -recursive infra` plus `terraform validate` on every module under `infra/*/`. Mirror that locally before pushing to avoid round-trips.

## Terraform workflow (per module)

Each subdirectory under `infra/` is its own root module with its own state prefix. To work on a module:

```sh
cd infra/<module>
cp backend.hcl.example backend.hcl   # first time only; edit bucket/prefix
terraform init -backend-config=backend.hcl
terraform plan -var project_id=YOUR_PROJECT_ID -var env=dev
terraform apply -var project_id=YOUR_PROJECT_ID -var env=dev
```

State prefixes are namespaced per module (e.g. `project/dev`, `coordinator/dev`) so modules don't collide in the shared bucket.

If you add a new module under `infra/`, the CI `terraform validate` step picks it up automatically — no allowlist to maintain.

## Common gotchas

- **`Error: Error 403: ...API has not been used in project`** — `infra/project` enables all required APIs; apply it before any other module.
- **`Error acquiring the state lock`** — someone (or a stale CI run) is holding the GCS object lock. Wait, or force-unlock with the lock ID from the error (only if you're sure nobody else is mid-apply).
- **Stale `.terraform/` causing weird init errors** — `rm -rf .terraform .terraform.lock.hcl` and re-init. The lock file *should* be committed long-term, but during early bootstrap it's fine to regenerate.
- **husky hook didn't run** — make sure you ran `pnpm install` (not `npm install`); the `prepare` script wires husky.
- **Workspace dep not found after edit** — `pnpm install` to relink workspace symlinks.

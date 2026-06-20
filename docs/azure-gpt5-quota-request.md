# Azure OpenAI GPT-5 Quota Request

The Azure/GPT agent runs **gpt-4o** as an interim because the GPT-5 family has
**zero quota** on the new subscription. This note captures the exact request to
restore the GPT-5.x-class model the design calls for. Azure OpenAI quota
increases have **no CLI/API path** — they go through the Microsoft form below.

## Submit here

**https://aka.ms/oai/quotaincrease** (Azure OpenAI service quota increase form).
Or: Azure Portal → the `agent-tasker-dev-aoai` resource → **Quotas** → request
increase. Sign in as `joshua.lopez.tech@gmail.com`.

## Request details

- **Subscription:** `8db4717d-3d07-4714-9e42-913d1723d6d0` (Pay-As-You-Go)
- **Resource:** `agent-tasker-dev-aoai`, region **eastus**
- **Deployment type / SKU:** GlobalStandard

| Model | Current limit (eastus) | Requested TPM (thousands) | Used for |
|-------|------------------------|---------------------------|----------|
| `gpt-5`      | 0 | 50  | execute (frontier) |
| `gpt-5-mini` | 0 | 100 | bid estimator |

(TPM values are modest, sized for a single-operator dev workload; raise if
throughput needs grow.)

## Current quota landscape (checked 2026-06-20)

- **`gpt-5` (frontier): 0 in every region** — always needs a request.
- **`gpt-5-mini`: already has 500 in eastus2 and swedencentral**, but **0 in
  eastus** (our resource's region). So in eastus, both need a request.

**Alternative to a gpt-5-mini request:** stand up the Azure OpenAI resource in
**eastus2** or **swedencentral**, where gpt-5-mini already has quota — then only
`gpt-5` needs a request. That means recreating `agent-tasker-dev-aoai` in the new
region and updating `azure_openai_endpoint` in
`infra/agent-azure-gpt/terraform.tfvars` (the Container App can call cross-region,
but co-locating is cleaner).

## After quota is granted

1. Create the deployments (region of the resource):
   ```
   az cognitiveservices account deployment create -g agent-tasker-dev-azure \
     -n agent-tasker-dev-aoai --deployment-name gpt-5 \
     --model-name gpt-5 --model-version 2025-08-07 --model-format OpenAI \
     --sku-name GlobalStandard --sku-capacity 50
   # repeat for gpt-5-mini (capacity 100)
   ```
2. In `infra/agent-azure-gpt/terraform.tfvars` set:
   ```
   azure_openai_deployment     = "gpt-5"
   azure_openai_bid_deployment = "gpt-5-mini"
   ```
3. Open a PR; on merge CI redeploys the Container App pointing at the GPT-5
   deployments. (Also drop the gpt-4o deployment if no longer needed.)

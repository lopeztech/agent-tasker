env = "dev"

jwks_url = "https://storage.googleapis.com/agent-tasker-dev-jwks-agent-tasker-lcd/jwks.json"

# Interim: the GPT-5 family has 0 quota on this new subscription (needs an Azure
# support request). gpt-4o has default Standard quota and deploys now, so both
# bid and execute point at the single gpt-4o deployment. Swap to gpt-5 /
# gpt-5-mini here once the GPT-5 quota increase is granted.
azure_openai_deployment     = "gpt-4o"
azure_openai_bid_deployment = "gpt-4o"
azure_openai_api_version    = "2025-04-01-preview"

# agent_image is intentionally absent — CI passes it as
# -var="agent_image=ACR_LOGIN_SERVER/azure-gpt:SHA".
# azure_openai_api_key is passed out-of-band (TF_VAR_azure_openai_api_key in CI
# from the AZURE_OPENAI_API_KEY secret) so it is never committed.

# From infra/azure-bootstrap apply (2026-06-20) + the Azure OpenAI resource.
subscription_id     = "8db4717d-3d07-4714-9e42-913d1723d6d0"
tenant_id           = "86c1ecd5-782f-4afe-81f1-385bd7abc649"
resource_group_name = "agent-tasker-dev-azure"
# CI service principal (azure-bootstrap ci_object_id) — the steady-state
# deployer that needs Key Vault secret access on every CI apply.
deployer_object_id    = "f1b06116-7707-42c5-9a14-4b0cfd1074eb"
azure_openai_endpoint = "https://agent-tasker-dev-aoai.openai.azure.com/"
acr_login_server      = "agenttaskerdevazgptacr.azurecr.io"
acr_resource_id       = "/subscriptions/8db4717d-3d07-4714-9e42-913d1723d6d0/resourceGroups/agent-tasker-dev-azure/providers/Microsoft.ContainerRegistry/registries/agenttaskerdevazgptacr"

env = "dev"

jwks_url = "https://storage.googleapis.com/agent-tasker-dev-jwks-agent-tasker-lcd/jwks.json"

azure_openai_deployment     = "gpt-5"
azure_openai_bid_deployment = "gpt-5-mini"
azure_openai_api_version    = "2025-04-01-preview"

# agent_image is intentionally absent — CI passes it as
# -var="agent_image=ACR_LOGIN_SERVER/azure-gpt:SHA".

# These require infra/azure-bootstrap to be applied first:
# subscription_id    = "..."   # az account show --query id -o tsv
# tenant_id          = "..."   # az account show --query tenantId -o tsv
# resource_group_name = "..."  # resource_group_name output from azure-bootstrap
# azure_openai_endpoint = "..." # your Azure OpenAI endpoint
# acr_login_server   = "..."   # acr_login_server output from azure-bootstrap
# acr_resource_id    = "..."   # acr_resource_id output from azure-bootstrap

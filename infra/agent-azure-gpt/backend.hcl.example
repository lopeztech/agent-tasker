# Copy to backend.hcl per environment and pass to:
#   terraform init -backend-config=backend.hcl
#
# Uses the Azure Storage account/container created by infra/azure-bootstrap.

resource_group_name  = "agent-tasker-dev-azure"
storage_account_name = "agenttaskerdevtfstate"
container_name       = "tfstate"
key                  = "agent-azure-gpt/dev.tfstate"
use_azuread_auth     = true

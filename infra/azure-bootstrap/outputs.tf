output "resource_group_name" {
  description = "Azure resource group that will host Azure/GPT agent resources."
  value       = azurerm_resource_group.bootstrap.name
}

output "resource_group_id" {
  description = "Azure resource group ID for downstream role assignments and scoped deploys."
  value       = azurerm_resource_group.bootstrap.id
}

output "state_storage_account_name" {
  description = "Storage account name for Azure Terraform state."
  value       = azurerm_storage_account.tfstate.name
}

output "state_container_name" {
  description = "Blob container name for Azure Terraform state."
  value       = azurerm_storage_container.tfstate.name
}

output "ci_client_id" {
  description = "Client ID for the GitHub Actions OIDC CI service principal."
  value       = azuread_application.ci.client_id
}

output "ci_object_id" {
  description = "Object ID for the GitHub Actions OIDC CI service principal."
  value       = azuread_service_principal.ci.object_id
}

output "agent_client_id" {
  description = "Client ID for the Azure/GPT agent app registration."
  value       = azuread_application.agent.client_id
}

output "agent_service_principal_object_id" {
  description = "Object ID for the Azure/GPT agent enterprise application."
  value       = azuread_service_principal.agent.object_id
}

output "acr_login_server" {
  description = "ACR login server hostname (e.g. agenttaskerdevazgptacr.azurecr.io). Set as AZURE_GPT_ACR_LOGIN_SERVER in ci.yml and acr_login_server in infra/agent-azure-gpt/terraform.tfvars."
  value       = azurerm_container_registry.agent.login_server
}

output "acr_resource_id" {
  description = "ACR resource ID. Set as acr_resource_id in infra/agent-azure-gpt/terraform.tfvars so the module can assign AcrPull to the Container App managed identity."
  value       = azurerm_container_registry.agent.id
}

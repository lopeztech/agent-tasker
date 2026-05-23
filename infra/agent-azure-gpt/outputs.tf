output "agent_url" {
  description = "Public HTTPS URL for the Azure/GPT Container App. Coordinator per-agent endpoint config points at this."
  value       = "https://${azurerm_container_app.agent.latest_revision_fqdn}"
}

output "agent_principal_id" {
  description = "Managed identity principal ID for the Azure/GPT Container App."
  value       = azurerm_container_app.agent.identity[0].principal_id
}

output "key_vault_uri" {
  description = "Key Vault URI that stores the Azure OpenAI credential."
  value       = azurerm_key_vault.agent.vault_uri
}

output "azure_openai_api_key_secret_name" {
  description = "Key Vault secret name the Azure/GPT agent reads for the Azure OpenAI API key."
  value       = var.azure_openai_api_key_secret_name
}

output "log_analytics_workspace_id" {
  description = "Log Analytics workspace ID backing the Azure/GPT Container Apps environment."
  value       = azurerm_log_analytics_workspace.agent.id
}

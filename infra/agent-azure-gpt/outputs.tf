output "agent_url" {
  description = "Public HTTPS URL for the Azure/GPT Container App. Coordinator per-agent endpoint config points at this."
  # Stable ingress FQDN (revision_mode = Single routes it to the latest
  # revision). Not latest_revision_fqdn, which changes on every new revision and
  # would break the coordinator's pinned endpoint on each deploy.
  value = "https://${azurerm_container_app.agent.ingress[0].fqdn}"
}

output "agent_principal_id" {
  description = "User-assigned managed identity principal ID for the Azure/GPT Container App."
  value       = azurerm_user_assigned_identity.agent.principal_id
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

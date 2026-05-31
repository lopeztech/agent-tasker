# Grant the Container App's system-assigned managed identity AcrPull on the
# ACR so it can pull images without a stored credential. The ACR resource is
# managed in infra/azure-bootstrap; its ID is threaded in via var.acr_resource_id.
resource "azurerm_role_assignment" "agent_acr_pull" {
  scope                = var.acr_resource_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_container_app.agent.identity[0].principal_id
}

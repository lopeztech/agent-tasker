# Identity for the Azure/GPT Container App.
#
# A user-assigned managed identity (not system-assigned) is required to break a
# deadlock: a system-assigned identity only exists once the Container App is
# created, but the app cannot provision its first revision without AcrPull to
# pull the image from ACR — so the app fails before the role can be granted.
# A user-assigned identity exists independently, so AcrPull is granted before
# the app provisions. The Container App and Key Vault policy reference this
# identity, and the app `depends_on` the role assignment below.
resource "azurerm_user_assigned_identity" "agent" {
  name                = "${local.name_prefix}-azure-gpt-id"
  location            = data.azurerm_resource_group.agent.location
  resource_group_name = data.azurerm_resource_group.agent.name
  tags                = local.common_tags
}

# Grant the agent's user-assigned identity AcrPull on the ACR so it can pull
# images without a stored credential. The ACR resource is managed in
# infra/azure-bootstrap; its ID is threaded in via var.acr_resource_id.
resource "azurerm_role_assignment" "agent_acr_pull" {
  scope                = var.acr_resource_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.agent.principal_id
}

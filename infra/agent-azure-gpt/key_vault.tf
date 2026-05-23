resource "azurerm_key_vault" "agent" {
  name                       = local.key_vault_name
  location                   = data.azurerm_resource_group.agent.location
  resource_group_name        = data.azurerm_resource_group.agent.name
  tenant_id                  = var.tenant_id
  sku_name                   = "standard"
  soft_delete_retention_days = 7
  purge_protection_enabled   = true
  tags                       = local.common_tags
}

resource "azurerm_key_vault_access_policy" "deployer" {
  key_vault_id = azurerm_key_vault.agent.id
  tenant_id    = var.tenant_id
  object_id    = data.azurerm_client_config.current.object_id

  secret_permissions = [
    "Delete",
    "Get",
    "List",
    "Set",
  ]
}

resource "azurerm_key_vault_access_policy" "agent" {
  key_vault_id = azurerm_key_vault.agent.id
  tenant_id    = var.tenant_id
  object_id    = azurerm_container_app.agent.identity[0].principal_id

  secret_permissions = [
    "Get",
    "List",
  ]
}

resource "azurerm_key_vault_secret" "azure_openai_api_key" {
  count        = var.azure_openai_api_key == null ? 0 : 1
  name         = var.azure_openai_api_key_secret_name
  value        = var.azure_openai_api_key
  key_vault_id = azurerm_key_vault.agent.id

  depends_on = [
    azurerm_key_vault_access_policy.deployer,
  ]
}

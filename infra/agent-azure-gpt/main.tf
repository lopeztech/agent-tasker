provider "azurerm" {
  subscription_id = var.subscription_id
  tenant_id       = var.tenant_id

  features {}
}

data "azurerm_client_config" "current" {}

data "azurerm_resource_group" "agent" {
  name = var.resource_group_name
}

locals {
  name_prefix = "${var.project}-${var.env}"

  common_tags = merge(
    {
      project = var.project
      env     = var.env
      module  = "agent-azure-gpt"
    },
    var.tags,
  )

  key_vault_name = coalesce(
    var.key_vault_name,
    substr(replace("${var.project}${var.env}azgptkv", "-", ""), 0, 24),
  )
}

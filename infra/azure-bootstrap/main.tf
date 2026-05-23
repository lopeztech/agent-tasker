provider "azurerm" {
  subscription_id = var.subscription_id
  tenant_id       = var.tenant_id

  features {}
}

provider "azuread" {
  tenant_id = var.tenant_id
}

locals {
  name_prefix = "${var.project}-${var.env}"

  common_tags = merge(
    {
      project = var.project
      env     = var.env
      module  = "azure-bootstrap"
    },
    var.tags,
  )

  storage_account_base = replace("${var.project}${var.env}tfstate", "-", "")
  storage_account_name = coalesce(
    var.storage_account_name,
    substr("${local.storage_account_base}${var.storage_account_suffix}", 0, 24),
  )
}

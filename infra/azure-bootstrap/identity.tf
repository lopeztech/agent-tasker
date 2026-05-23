resource "azuread_application" "ci" {
  display_name     = "${local.name_prefix}-azure-ci"
  sign_in_audience = "AzureADMyOrg"
}

resource "azuread_service_principal" "ci" {
  client_id                    = azuread_application.ci.client_id
  app_role_assignment_required = false
}

resource "azuread_application_federated_identity_credential" "ci_main_branch" {
  application_id = azuread_application.ci.id
  display_name   = "github-${var.github_owner}-${var.github_repository}-${var.github_branch}"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:${var.github_owner}/${var.github_repository}:ref:refs/heads/${var.github_branch}"
}

resource "azurerm_role_assignment" "ci_rg_contributor" {
  scope                = azurerm_resource_group.bootstrap.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.ci.object_id
}

resource "azurerm_role_assignment" "ci_state_blob_contributor" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azuread_service_principal.ci.object_id
}

resource "azuread_application" "agent" {
  display_name     = "${local.name_prefix}-azure-gpt-agent"
  sign_in_audience = "AzureADMyOrg"
}

resource "azuread_service_principal" "agent" {
  client_id                    = azuread_application.agent.client_id
  app_role_assignment_required = false
}

resource "azurerm_log_analytics_workspace" "agent" {
  name                = "${local.name_prefix}-azure-gpt-logs"
  location            = data.azurerm_resource_group.agent.location
  resource_group_name = data.azurerm_resource_group.agent.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.common_tags
}

resource "azurerm_container_app_environment" "agent" {
  name                       = "${local.name_prefix}-azure-gpt-env"
  location                   = data.azurerm_resource_group.agent.location
  resource_group_name        = data.azurerm_resource_group.agent.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.agent.id
  tags                       = local.common_tags
}

resource "azurerm_container_app" "agent" {
  name                         = "${local.name_prefix}-azure-gpt"
  container_app_environment_id = azurerm_container_app_environment.agent.id
  resource_group_name          = data.azurerm_resource_group.agent.name
  revision_mode                = "Single"
  tags                         = local.common_tags

  identity {
    type = "SystemAssigned"
  }

  secret {
    name  = var.azure_openai_api_key_secret_name
    value = coalesce(var.azure_openai_api_key, "replace-me")
  }

  ingress {
    external_enabled = true
    target_port      = var.agent_port
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.agent_min_replicas
    max_replicas = var.agent_max_replicas

    container {
      name   = "azure-gpt"
      image  = var.agent_image
      cpu    = var.agent_cpu
      memory = var.agent_memory

      env {
        name  = "AGENT_ID"
        value = "azure-gpt"
      }

      env {
        name  = "JWKS_URL"
        value = var.jwks_url
      }

      env {
        name  = "AZURE_OPENAI_ENDPOINT"
        value = var.azure_openai_endpoint
      }

      env {
        name  = "AZURE_OPENAI_DEPLOYMENT"
        value = var.azure_openai_deployment
      }

      env {
        name  = "AZURE_OPENAI_BID_DEPLOYMENT"
        value = var.azure_openai_bid_deployment
      }

      env {
        name  = "AZURE_OPENAI_API_VERSION"
        value = var.azure_openai_api_version
      }

      env {
        name  = "AZURE_OPENAI_API_KEY_SECRET_NAME"
        value = var.azure_openai_api_key_secret_name
      }

      env {
        name        = "AZURE_OPENAI_API_KEY"
        secret_name = var.azure_openai_api_key_secret_name
      }

      env {
        name  = "KEY_VAULT_URI"
        value = azurerm_key_vault.agent.vault_uri
      }
    }
  }
}

# Azure Bootstrap

Bootstraps the Azure subscription pieces that later Azure/GPT infra roots depend on:

- a resource group for the Phase 3 Azure/GPT agent
- a Storage Account + Blob container for Terraform state
- a GitHub Actions OIDC CI service principal scoped to the resource group and state storage
- a separate Microsoft Entra app registration/service principal for the Azure/GPT agent

This root intentionally has no remote backend block: it creates the storage account that later Azure roots should use as their `azurerm` backend.

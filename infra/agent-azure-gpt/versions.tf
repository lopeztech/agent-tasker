terraform {
  required_version = ">= 1.7"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.72"
    }
  }

  # Backend is left as a partial config so each environment supplies the
  # Azure Storage account created by infra/azure-bootstrap:
  #
  #   terraform init -backend-config=backend.hcl
  #
  # See backend.hcl.example.
  backend "azurerm" {}
}

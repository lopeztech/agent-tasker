terraform {
  required_version = ">= 1.10" # variable validations rely on &&/|| short-circuit (TF 1.10+)

  required_providers {
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.8"
    }
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.72"
    }
  }
}

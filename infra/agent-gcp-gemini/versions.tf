terraform {
  required_version = ">= 1.10" # variable validations rely on &&/|| short-circuit (TF 1.10+)

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.10"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.10"
    }
  }

  backend "gcs" {}
}

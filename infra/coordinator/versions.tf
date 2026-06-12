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
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.6"
    }
  }

  # Backend is left as a partial config so each environment supplies its own
  # bucket at init time:
  #
  #   terraform init -backend-config=backend.hcl
  #
  # See backend.hcl.example.
  backend "gcs" {}
}

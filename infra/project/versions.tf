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

  # Backend is left as a partial config so each environment supplies its own
  # bucket at init time:
  #
  #   terraform init -backend-config=backend.hcl
  #
  # See backend.hcl.example. GCS handles state locking natively via object
  # generation — no separate lock table required (unlike AWS S3 + DynamoDB).
  backend "gcs" {}
}

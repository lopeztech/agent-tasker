terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # Backend is left as a partial config so each environment supplies its own
  # bucket / lock table at init time:
  #
  #   terraform init -backend-config=backend.hcl
  #
  # See backend.hcl.example for the expected keys.
  backend "s3" {}
}

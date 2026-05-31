terraform {
  required_version = ">= 1.7"

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }

    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.100"
    }
  }

  # GCS backend keeps all Terraform state in the same bucket regardless of
  # which cloud the module manages — consistent with the rest of this repo.
  # The GCS credentials come from the same WIF auth that the deploy job uses;
  # no separate S3 state bucket or DynamoDB lock table required.
  #
  #   terraform init -backend-config=backend.hcl
  #
  # See backend.hcl.example for the bucket/prefix values.
  backend "gcs" {}
}

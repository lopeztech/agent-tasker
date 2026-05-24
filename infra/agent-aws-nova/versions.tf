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

  # Backend is left as a partial config so each environment supplies the
  # S3 state bucket/key details:
  #
  #   terraform init -backend-config=backend.hcl
  #
  # See backend.hcl.example.
  backend "s3" {}
}

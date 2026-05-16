provider "aws" {
  region = var.region

  default_tags {
    tags = local.common_tags
  }
}

locals {
  name_prefix = "${var.project}-${var.env}"

  common_tags = merge(
    {
      Project = var.project
      Env     = var.env
      Module  = "coordinator"
    },
    var.tags,
  )
}

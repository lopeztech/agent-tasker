provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

data "aws_partition" "current" {}

locals {
  name_prefix = "${var.project}-${var.env}"

  common_tags = merge(
    {
      project = var.project
      env     = var.env
      module  = "agent-aws-nova"
    },
    var.tags,
  )
}

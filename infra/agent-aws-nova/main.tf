provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

data "aws_partition" "current" {}

locals {
  name_prefix = "${var.project}-${var.env}"
  agent_name  = "${local.name_prefix}-aws-nova"

  common_tags = merge(
    {
      project = var.project
      env     = var.env
      module  = "agent-aws-nova"
    },
    var.tags,
  )
}

provider "google" {
  project = var.project_id
  region  = var.region

  default_labels = local.common_labels
}

provider "google-beta" {
  project = var.project_id
  region  = var.region

  default_labels = local.common_labels
}

locals {
  name_prefix = "${var.project}-${var.env}"

  common_labels = merge(
    {
      project = var.project
      env     = var.env
      module  = "project"
    },
    var.labels,
  )
}

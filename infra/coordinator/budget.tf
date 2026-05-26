data "google_project" "current" {
  count = var.cost_budget_monthly_usd == null || var.billing_account_id == null ? 0 : 1

  project_id = var.project_id
}

data "google_billing_account" "current" {
  count = var.cost_budget_monthly_usd == null || var.billing_account_id == null ? 0 : 1

  billing_account = var.billing_account_id
}

resource "google_billing_budget" "project" {
  count = var.cost_budget_monthly_usd == null || var.billing_account_id == null ? 0 : 1

  billing_account = data.google_billing_account.current[0].id
  display_name    = "${local.name_prefix}-gcp-budget"

  budget_filter {
    projects = ["projects/${data.google_project.current[0].number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.cost_budget_monthly_usd)
    }
  }

  dynamic "threshold_rules" {
    for_each = var.cost_budget_threshold_percents

    content {
      threshold_percent = threshold_rules.value / 100
      spend_basis       = "CURRENT_SPEND"
    }
  }

  all_updates_rule {
    monitoring_notification_channels = var.cost_budget_alert_notification_channels
    disable_default_iam_recipients   = length(var.cost_budget_alert_notification_channels) > 0
  }
}

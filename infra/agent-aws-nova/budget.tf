resource "aws_budgets_budget" "agent" {
  count = var.cost_budget_monthly_usd == null ? 0 : 1

  name         = "${local.agent_name}-budget"
  budget_type  = "COST"
  limit_amount = tostring(var.cost_budget_monthly_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = var.cost_budget_threshold_percents

    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = var.cost_budget_alert_emails
    }
  }
}

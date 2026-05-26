resource "azurerm_consumption_budget_resource_group" "agent" {
  count = var.cost_budget_monthly_usd == null ? 0 : 1

  name              = "${local.name_prefix}-azure-gpt-budget"
  resource_group_id = data.azurerm_resource_group.agent.id
  amount            = var.cost_budget_monthly_usd
  time_grain        = "Monthly"

  time_period {
    start_date = var.cost_budget_start_date
  }

  dynamic "notification" {
    for_each = var.cost_budget_threshold_percents

    content {
      enabled        = true
      threshold      = notification.value
      operator       = "GreaterThan"
      threshold_type = "Actual"
      contact_emails = var.cost_budget_alert_emails
    }
  }
}

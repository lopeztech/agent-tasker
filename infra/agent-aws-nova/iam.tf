# Runtime identity for the AWS/Nova agent.
#
# The model-family lock is load-bearing: this role can invoke only Amazon
# Nova Bedrock foundation models in the configured region. It cannot call
# Anthropic, Meta, Cohere, or any future non-Nova provider family through
# Bedrock. The Lambda/API Gateway stack that assumes this role lands in #43.

data "aws_iam_policy_document" "agent_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "agent_runtime" {
  name               = "${local.agent_name}-runtime"
  description        = "Runtime role for the AWS/Nova agent; Bedrock access is limited to Amazon Nova models."
  assume_role_policy = data.aws_iam_policy_document.agent_assume_role.json
}

locals {
  nova_foundation_model_arns = [
    "arn:${data.aws_partition.current.partition}:bedrock:${var.aws_region}::foundation-model/amazon.nova-micro-v1:*",
    "arn:${data.aws_partition.current.partition}:bedrock:${var.aws_region}::foundation-model/amazon.nova-lite-v1:*",
    "arn:${data.aws_partition.current.partition}:bedrock:${var.aws_region}::foundation-model/amazon.nova-pro-v1:*",
  ]
}

data "aws_iam_policy_document" "agent_bedrock_nova" {
  statement {
    sid    = "InvokeAmazonNovaOnly"
    effect = "Allow"

    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]

    resources = local.nova_foundation_model_arns
  }
}

resource "aws_iam_role_policy" "agent_bedrock_nova" {
  name   = "${local.agent_name}-bedrock"
  role   = aws_iam_role.agent_runtime.id
  policy = data.aws_iam_policy_document.agent_bedrock_nova.json
}

data "aws_iam_policy_document" "agent_logs" {
  statement {
    sid    = "WriteOwnLambdaLogs"
    effect = "Allow"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]

    resources = ["${aws_cloudwatch_log_group.agent.arn}:*"]
  }
}

resource "aws_iam_role_policy" "agent_logs" {
  name   = "${local.agent_name}-logs"
  role   = aws_iam_role.agent_runtime.id
  policy = data.aws_iam_policy_document.agent_logs.json
}

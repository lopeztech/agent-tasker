# GitHub Actions OIDC identity provider and CI/CD role for the AWS/Nova module.
#
# After applying, copy the cicd_role_arn output into GitHub Actions secrets:
#   AWS_ROLE_ARN  ←  cicd_role_arn output
#
# The role uses AdministratorAccess for the same reason the GCP CI SA uses
# roles/owner: managing Lambda, IAM, API Gateway, S3, CloudWatch, and WIF
# resources across this module converges on admin for a single-operator
# project. Re-evaluate if the project becomes multi-tenant.

data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  # GitHub's OIDC thumbprint — stable and well-known.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "cicd_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Scope to main branch only so PR/fork tokens cannot assume this role.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "cicd" {
  name               = "${local.agent_name}-cicd"
  description        = "CI/CD role for GitHub Actions - manages this module's Lambda, API Gateway, IAM, and S3 resources."
  assume_role_policy = data.aws_iam_policy_document.cicd_assume_role.json
}

resource "aws_iam_role_policy_attachment" "cicd_admin" {
  role       = aws_iam_role.cicd.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

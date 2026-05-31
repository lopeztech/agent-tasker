env        = "dev"
aws_region = "us-east-1"

jwks_url = "https://storage.googleapis.com/agent-tasker-dev-jwks-agent-tasker-lcd/jwks.json"

# agent_lambda_s3_key is intentionally absent — CI passes it as
# -var="agent_lambda_s3_key=aws-nova-SHA.zip" so no hardcoded tag lives
# in the repo. The variable default points to the bootstrap placeholder.

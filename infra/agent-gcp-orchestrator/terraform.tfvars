project_id = "agent-tasker-lcd"
project    = "agent-tasker"
env        = "dev"
region     = "us-central1"

# agent_image is intentionally absent — CI passes it as
# -var="agent_image=REPO:SHA" so no hardcoded tag lives in the repo.
# The variable default (gcr.io/cloudrun/hello) is only used on a fresh
# terraform apply before the first CI run.

coordinator_service_account_email = "agent-tasker-dev-coordinator@agent-tasker-lcd.iam.gserviceaccount.com"
jwks_url                          = "https://storage.googleapis.com/agent-tasker-dev-jwks-agent-tasker-lcd/jwks.json"

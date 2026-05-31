project_id = "agent-tasker-lcd"
project    = "agent-tasker"
env        = "dev"
region     = "us-central1"

# coordinator_image is intentionally absent — CI passes it as
# -var="coordinator_image=REPO:SHA" so no hardcoded tag lives in the repo.
# The variable default (gcr.io/cloudrun/hello) is only used on a fresh
# terraform apply before the first CI run.

coordinator_min_instances = 1

gcp_gemini_agent_url       = "https://agent-tasker-dev-gcp-gemini-n6ey4mj4ma-uc.a.run.app"
gcp_orchestrator_agent_url = "https://agent-tasker-dev-gcp-orchestrator-n6ey4mj4ma-uc.a.run.app"

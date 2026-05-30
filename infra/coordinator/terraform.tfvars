project_id = "agent-tasker-lcd"
project    = "agent-tasker"
env        = "dev"
region     = "us-central1"

coordinator_min_instances = 1
coordinator_image         = "us-central1-docker.pkg.dev/agent-tasker-lcd/agent-tasker-dev-coordinator/coordinator:8b69da6"

gcp_gemini_agent_url       = "https://agent-tasker-dev-gcp-gemini-n6ey4mj4ma-uc.a.run.app"
gcp_orchestrator_agent_url = "https://agent-tasker-dev-gcp-orchestrator-n6ey4mj4ma-uc.a.run.app"

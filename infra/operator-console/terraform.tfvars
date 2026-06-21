project_id = "agent-tasker-lcd"
project    = "agent-tasker"
env        = "dev"
region     = "us-central1"

custom_domain        = "tasker.lopezcloud.dev"
cloudflare_zone_name = "lopezcloud.dev"

# console_image is intentionally absent — CI passes it as
# -var="console_image=REPO:SHA" so no hardcoded tag lives in the repo.
# The variable default (gcr.io/cloudrun/hello) is only used on a fresh
# terraform apply before the first image is built and pushed.
#
# cloudflare_api_token is intentionally absent — supplied via
# TF_VAR_cloudflare_api_token (GitHub secret CLOUDFLARE_API_TOKEN) at apply
# time so the secret never lands in the repo.

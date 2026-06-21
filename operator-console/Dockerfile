# Static container for the Agent Tasker operator console (Market Terminal).
#
# The app is plain HTML/CSS/JS with no build step (its `build` script just
# verifies the static files), so the image only needs to serve them. We use
# the unprivileged nginx image: it runs as a non-root user and listens on
# 8080 by default, matching Cloud Run's port and the repo's non-root runtime
# posture (coordinator/agents run as non-root too).
#
# Build with operator-console/ as the context — the repo-root .dockerignore
# deliberately excludes this dir from the *agents'* build contexts, so the
# image is built from here instead of the repo root:
#
#   docker build -f operator-console/Dockerfile -t operator-console:dev operator-console
#
# Push to Artifact Registry (repo path = `console_image_repo` Terraform output):
#   gcloud auth configure-docker LOCATION-docker.pkg.dev
#   docker tag operator-console:dev LOCATION-docker.pkg.dev/PROJECT/REPO/operator-console:TAG
#   docker push LOCATION-docker.pkg.dev/PROJECT/REPO/operator-console:TAG

FROM nginxinc/nginx-unprivileged:1-alpine

# Replace the default server block with one that serves the SPA on 8080.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# The three static files are the whole app.
COPY index.html styles.css main.js /usr/share/nginx/html/

EXPOSE 8080

# Multi-stage build for the GCP/Gemini agent. Mirrors coordinator/Dockerfile.
#
# Build from the repo root:
#   docker build -f agent/gcp-gemini/Dockerfile -t gcp-gemini:dev .
#
# Push to Artifact Registry (image repo from the Terraform output):
#   gcloud auth configure-docker LOCATION-docker.pkg.dev
#   docker tag gcp-gemini:dev LOCATION-docker.pkg.dev/PROJECT/REPO/gcp-gemini:TAG
#   docker push LOCATION-docker.pkg.dev/PROJECT/REPO/gcp-gemini:TAG

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY protocol/ ./protocol/
COPY agent/ ./agent/
COPY coordinator/ ./coordinator/
COPY infra/ ./infra/
COPY eval/ ./eval/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter '@agent-tasker/agent-gcp-gemini...' build
RUN pnpm --filter @agent-tasker/agent-gcp-gemini deploy --prod /app

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "dist/server.js"]

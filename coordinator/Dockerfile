# Multi-stage build for the coordinator. Stage 1 installs and builds the
# whole monorepo; stage 2 uses `pnpm deploy` to copy the coordinator + its
# production deps (including the @agent-tasker/protocol workspace dep) into
# a self-contained /app directory; stage 3 is the runtime image.
#
# Result: ~200MB compressed image with no dev deps, no source, no tooling.
#
# Build from the repo root:
#   docker build -f coordinator/Dockerfile -t coordinator:dev .
#
# Push to Artifact Registry (image repo path comes from the `coordinator_image_repo` Terraform output):
#   gcloud auth configure-docker LOCATION-docker.pkg.dev
#   docker tag coordinator:dev LOCATION-docker.pkg.dev/PROJECT/REPO/coordinator:TAG
#   docker push LOCATION-docker.pkg.dev/PROJECT/REPO/coordinator:TAG

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
RUN pnpm --filter '@agent-tasker/coordinator...' build
# pnpm deploy bundles the coordinator + its production deps as a flat
# package at /app (workspace deps copied in as real node_modules entries).
RUN pnpm --filter @agent-tasker/coordinator deploy --prod /app

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
# Run as the non-root `node` user that the official Node image provides.
USER node
CMD ["node", "dist/server.js"]

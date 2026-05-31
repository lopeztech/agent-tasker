# Multi-stage build for the Azure/GPT agent. Mirrors gcp-gemini/Dockerfile.
#
# Build from the repo root:
#   docker build -f agent/azure-gpt/Dockerfile -t azure-gpt:dev .

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json .npmrc ./
COPY protocol/ ./protocol/
COPY agent/ ./agent/
COPY coordinator/ ./coordinator/
COPY infra/ ./infra/
COPY eval/ ./eval/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter '@agent-tasker/agent-azure-gpt...' build
RUN pnpm --filter @agent-tasker/agent-azure-gpt deploy --prod /app

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "dist/server.js"]

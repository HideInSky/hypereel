# Multi-stage build for the backend.
#   deps    -> install ALL deps (dev deps are needed to compile TypeScript and build the frontend)
#   build   -> compile TypeScript, generate Prisma client, build the frontend into ../frontend/dist
#   runtime -> small image with only production deps + compiled output
# Build context is the REPO ROOT (see docker-compose.yml / CI), because the
# workspaces' package-lock.json lives there and the backend serves the frontend build.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY codebase/backend/package.json codebase/backend/
COPY codebase/frontend/package.json codebase/frontend/
RUN npm ci

FROM deps AS build
COPY codebase ./codebase
COPY workflows ./workflows
RUN npm run build --workspace codebase/frontend \
 && npm run build --workspace codebase/backend \
 && npm prune --omit=dev \
 && npm run prisma:generate --workspace codebase/backend   # re-generate: prune can drop the generated client

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# openssl: Prisma's query engine needs it. Keep the image otherwise minimal.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/codebase/backend/package.json ./codebase/backend/
COPY --from=build /app/codebase/backend/dist ./codebase/backend/dist
COPY --from=build /app/codebase/backend/prisma ./codebase/backend/prisma
COPY --from=build /app/codebase/frontend/dist ./codebase/frontend/dist
COPY --from=build /app/workflows ./workflows
WORKDIR /app/codebase/backend
# Note: we run as root because managed volumes (e.g. Railway) are mounted
# root-owned at runtime, so a non-root user couldn't write /data. On Kubernetes
# you'd instead set `USER node` + securityContext.fsGroup on the volume.
RUN mkdir -p /data
ENV PORT=3000 DATA_DIR=/data
EXPOSE 3000
# Apply pending migrations, then start. `migrate deploy` is idempotent and
# never generates new migrations, which is what you want in prod.
CMD ["sh", "-c", "npm run migrate:deploy && node dist/server.js"]

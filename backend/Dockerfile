# Backend image — multi-stage, built from the REPO ROOT context.
#
# Why the root context: npm workspaces resolve @staff-scheduler/shared and the
# single lockfile from the repository root, so a backend-only context can no
# longer produce a correct node_modules tree. docker-compose passes
# `context: .` with this file as `dockerfile`.
#
# Why --ignore-scripts: the root prepare hook (husky) is dev-only and absent
# here, and npm runs even linked-workspace prepare hooks during ci — with no
# devDependencies installed that would fail. Nothing in this tree needs
# install scripts (bcrypt 6 ships prebuilt bindings, loaded at require time
# and smoke-tested after the build); @staff-scheduler/shared is compiled by
# an explicit build step instead.

FROM node:22-alpine AS base
WORKDIR /app

# Manifests only: keeps the dependency layer cacheable independent of source.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY packages/shared/package.json packages/shared/

# Build stage: full dev install for tsc.
FROM base AS build
RUN npm ci --workspace staff-scheduler-backend --include-workspace-root=false --ignore-scripts

COPY packages/shared packages/shared
COPY backend backend

RUN npm run build --workspace @staff-scheduler/shared \
    && npm run build --workspace staff-scheduler-backend

# Production stage: runtime dependencies + compiled output only.
FROM node:22-alpine AS production
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY packages/shared/package.json packages/shared/

RUN npm ci --omit=dev --workspace staff-scheduler-backend --include-workspace-root=false --ignore-scripts \
    && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/backend/dist backend/dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p backend/logs backend/reports backend/uploads && \
    chown -R nodejs:nodejs /app

USER nodejs

WORKDIR /app/backend

# Health check. The health route is only mounted under /api (see src/app.ts),
# never at the bare path — this must stay in sync with docker-compose.yml's
# healthcheck, which is what actually runs under `docker compose up` (compose
# overrides the image's HEALTHCHECK). This one is what standalone `docker run`
# / non-compose orchestrators see.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:3001/api/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))" || exit 1

EXPOSE 3001

CMD ["npm", "start"]

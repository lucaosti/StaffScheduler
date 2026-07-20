# Frontend image — multi-stage, built from the REPO ROOT context.
#
# Why the root context: the npm-workspaces lockfile lives at the repository
# root, so installs must start there (docker-compose passes `context: .` with
# this file as `dockerfile`). Scripts are skipped for the same husky reason as
# the backend image; esbuild (vite's binary) is the one package that needs its
# install step, rebuilt explicitly.

FROM node:22-alpine AS base
WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/

# Build stage
FROM base AS build
RUN npm ci --workspace staff-scheduler-frontend --include-workspace-root=false --ignore-scripts \
    && npm rebuild esbuild

COPY frontend frontend

# Vite bakes env vars at build time, so the API base must arrive as a build
# arg (a runtime env on the nginx container would be ignored). The relative
# default works with the nginx /api proxy on any host.
ARG REACT_APP_API_URL=/api
ENV REACT_APP_API_URL=$REACT_APP_API_URL

RUN npm run build --workspace staff-scheduler-frontend

# Production stage with nginx
FROM nginx:alpine AS production

# Copy custom nginx configuration
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built application from build stage
COPY --from=build /app/frontend/build /usr/share/nginx/html

# Create non-root user and fix ownership of nginx runtime dirs
RUN addgroup -g 1001 -S nginx_user && \
    adduser -S nginx_user -u 1001 && \
    chown -R nginx_user:nginx_user /usr/share/nginx/html && \
    chown -R nginx_user:nginx_user /var/cache/nginx && \
    chown -R nginx_user:nginx_user /var/log/nginx && \
    chown -R nginx_user:nginx_user /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown nginx_user:nginx_user /var/run/nginx.pid

USER nginx_user

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

EXPOSE 3000

# Multi-stage build for production optimization
FROM node:18-alpine AS base
WORKDIR /app

# Copy package files
COPY package*.json ./

# Build stage
FROM base AS build
# Install all dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application for production
RUN npm run build

# Production stage with nginx
FROM nginx:alpine AS production

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built application from build stage
COPY --from=build /app/build /usr/share/nginx/html

# Create non-root user for security
RUN addgroup -g 1001 -S nginx_user && \
    adduser -S nginx_user -u 1001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]

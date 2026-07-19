# Multi-stage build for production optimization
FROM node:22-alpine AS base
WORKDIR /app

# Copy package files
COPY package*.json ./

# Build stage
FROM base AS build
# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:22-alpine AS production
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application from build stage
COPY --from=build /app/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Create necessary directories with proper permissions
RUN mkdir -p logs reports uploads && \
    chown -R nodejs:nodejs /app logs reports uploads

# Switch to non-root user
USER nodejs

# Health check. The health route is only mounted under /api (see src/app.ts),
# never at the bare path — this must stay in sync with docker-compose.yml's
# healthcheck, which is what actually runs under `docker compose up` (compose
# overrides the image's HEALTHCHECK). This one is what standalone `docker run`
# / non-compose orchestrators see.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:3001/api/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))" || exit 1

EXPOSE 3001

CMD ["npm", "start"]

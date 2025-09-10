# Multi-stage build for production optimization
FROM node:18-alpine AS base
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
FROM node:18-alpine AS production
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

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

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:3001/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))" || exit 1

EXPOSE 3001

CMD ["npm", "start"]

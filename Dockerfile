# ==============================================================================
# CCMRS Production Dockerfile (Node.js 20 Alpine)
# Omnichannel Customer Complaint Management & Resolution System
# ==============================================================================

FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install dependencies (production only)
RUN npm ci --only=production

# ------------------------------------------------------------------------------
# Production Image
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=5001

# Add non-root user for container security
USER node

# Copy dependencies and application code from builder
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node . .

# Expose API & Web Portal port
EXPOSE 5001

# Container Healthcheck (Checks live channel & API status)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5001/api/channels/status || exit 1

# Start CCMRS Unified Server
CMD ["node", "server.js"]

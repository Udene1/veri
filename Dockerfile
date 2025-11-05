# VNS Node Dockerfile for E2E Testing
FROM node:22-alpine

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (ignore lifecycle scripts so we build after source is present)
RUN npm ci --ignore-scripts

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Create data directory
RUN mkdir -p /data

# Expose API port
EXPOSE 3001

# Set default environment variables
ENV DATA_DIR=/data
ENV ENABLE_VNS=true
ENV VERBOSE=false

# Start node
CMD ["node", "dist/cli.js", "--enable-vns", "--api-port", "3001", "--data-dir", "/data"]

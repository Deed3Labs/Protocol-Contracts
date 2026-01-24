# Use a base image with curl and bash
FROM ubuntu:22.04

# Install curl and other dependencies
RUN apt-get update && apt-get install -y curl unzip ca-certificates && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Verify Bun installation
RUN bun --version

# Set working directory
WORKDIR /app

# Copy package files first (for better Docker layer caching)
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile --production=false

# Copy source code
COPY . .

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start the server
CMD ["bun", "src/index.ts"]

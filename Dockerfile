# AI : Use official bun image as base
FROM oven/bun:1.2.20-alpine AS base

# AI : Set working directory
WORKDIR /app

# AI : Copy package.json and bun lockfile for dependency installation
COPY package.json bun.lock ./

# AI : Install dependencies
RUN bun install --frozen-lockfile --production

# AI : Copy backend source code
COPY back/ ./back/

# AI : Build the server bundle
RUN bun run build-back

# AI : Production stage - minimal image with only the bundled server
FROM oven/bun:1.2.20-alpine AS production

# AI : Set working directory
WORKDIR /app

# AI : Copy only the bundled server and necessary files
COPY --from=base /app/server.bundle.js ./server.bundle.js

# AI : Create uploads directory for file uploads
RUN mkdir -p uploads

# AI : Expose port (default 3000, can be overridden by PORT env var)
EXPOSE 3000

# AI : Set default environment
ENV NODE_ENV=production

# AI : Run the bundled server
CMD ["bun", "server.bundle.js"]
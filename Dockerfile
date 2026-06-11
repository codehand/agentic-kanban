# syntax=docker/dockerfile:1
# Multi-stage build for the Agentic Kanban (aka-mcp) Task Hub.
#
# Stage 1 (build): compile TypeScript + build the native better-sqlite3 binding
#   INSIDE the image (never copy host node_modules — the native .node is
#   platform-specific and would break across host/container architectures).
# Stage 2 (runtime): production deps only + compiled dist + static UI.
#
# No secret (ADMIN_TOKEN) and no database file are baked into any layer; both
# are provided at runtime via env + a host bind-mount (see docker-compose.yml).

# ---------- Stage 1: build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Toolchain for compiling better-sqlite3's native addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Install ALL deps (incl. dev) with native builds, using lockfile for repeatability.
# pnpm 10 blocks build scripts by default (ERR_PNPM_IGNORED_BUILDS even though
# .npmrc allowlists better-sqlite3); explicitly approve, then force-build the
# native better-sqlite3 binding INSIDE the image.
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm config set dangerously-allow-all-builds true \
  && pnpm install --frozen-lockfile \
  && pnpm rebuild better-sqlite3

# Compile TS -> dist (also copies SQL migrations into dist/db/migrations).
COPY tsconfig.json ./
COPY server ./server
RUN pnpm build

# Prune to production deps only (keeps the compiled native better-sqlite3 binding).
RUN pnpm prune --prod

# ---------- Stage 2: runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/tasks.db

# Production node_modules (with native binding built in stage 1) + compiled output.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# Static UI assets served by the HTTP server (resolved from CWD/design-system).
COPY design-system ./design-system

# Data dir is a mount point; created so the server can open the DB even if the
# bind-mount is empty on first run.
RUN mkdir -p /data

EXPOSE 3000

# Liveness: hit the unauthenticated /healthz endpoint.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Production entry with graceful shutdown (SIGTERM from `docker stop`).
CMD ["node", "dist/index.js"]

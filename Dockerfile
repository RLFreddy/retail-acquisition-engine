# ==========================================
# Stage 1: Shared base and pnpm setup
# ==========================================
# Node version: must match .nvmrc (CI checks it)
FROM node:24.21.0-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# ==========================================
# Stage 2: Production dependencies
# ==========================================
FROM base AS prod-deps
# No toolchain: better-sqlite3 v13 ships prebuilt binaries for Linux (glibc
# and musl), macOS and Windows; pnpm-workspace.yaml skips its node-gyp build.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

# ==========================================
# Stage 3: Build (TypeScript / Assets)
# ==========================================
FROM base AS build
# Same as prod-deps: native modules install from prebuilts, no toolchain needed.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ==========================================
# Stage 4: Final runtime (ultra slim)
# ==========================================
FROM node:24.21.0-slim AS runtime

ENV NODE_ENV=production \
    OUTPUT_DIR=/app/data

WORKDIR /app

# Pre-create the output directory with permissions for the 'node' user
RUN mkdir -p /app/data && chown -R node:node /app

# Copy artifacts assigning ownership directly to the node user
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./

# Entrypoint runs as root to fix the ownership of the bind-mounted output
# root (docker auto-creates missing sources as root), then drops to 'node'.
# Same pattern as the official postgres image; the app process never runs as root.
# hadolint ignore=DL3002
COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# hadolint ignore=DL3002
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]

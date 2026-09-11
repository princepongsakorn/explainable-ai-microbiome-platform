# syntax=docker/dockerfile:1.6
#
# Multi-stage build for the NestJS backend.
# Final image only contains compiled JS + production node_modules.

# ---------- Stage 1: build ----------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install all deps (including devDependencies needed for `nest build`).
COPY package*.json ./
RUN npm ci

# Copy source and compile to /app/dist
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Trim devDependencies for the runtime image.
RUN npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:20-bookworm-slim AS runtime

# tini for proper signal handling under PID 1
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# Drop root for runtime
RUN groupadd --system --gid 1001 app \
 && useradd  --system --uid 1001 --gid app --no-create-home --shell /usr/sbin/nologin app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./package.json

USER app

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]

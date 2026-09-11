# syntax=docker/dockerfile:1.6
#
# Multi-stage build for the Next.js 12 frontend.
# Uses Next standalone output (next.config.js: output: 'standalone')
# to produce a minimal runtime image.

# ---------- Stage 1: deps ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---------- Stage 2: build ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* are inlined at build time — must be present BEFORE `next build`.
ARG NEXT_PUBLIC_API="/api"
ENV NEXT_PUBLIC_API=$NEXT_PUBLIC_API
# Disable Next telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- Stage 3: runtime ----------
FROM node:20-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin nextjs

# Copy minimal standalone output (Next 12+ produces .next/standalone with bundled node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

# Override default 3000 → 3001 to avoid collision with backend
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]

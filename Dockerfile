# Multi-stage build for any container host (Railway, Render, Fly, a VPS).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
# `output: "standalone"` in next.config.mjs emits a self-contained server.
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Settings live on a mounted volume, not in the image — a redeploy replaces the
# image, and anything written inside it would be lost.
ENV GBAT_DATA_DIR=/data

RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs gbat \
 && mkdir -p /data && chown -R gbat:nodejs /data

COPY --from=builder --chown=gbat:nodejs /app/.next/standalone ./
COPY --from=builder --chown=gbat:nodejs /app/.next/static ./.next/static

USER gbat
EXPOSE 3000
# The platform overrides PORT; HOSTNAME must be 0.0.0.0 inside a container.
ENV PORT=3000 HOSTNAME=0.0.0.0
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" | grep -q '"ok":true'

CMD ["node", "server.js"]

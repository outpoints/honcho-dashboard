# syntax=docker/dockerfile:1.7

# ---------- deps ----------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---------- build ----------
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are inlined into the browser bundle at build time, not
# runtime. Pass --build-arg NEXT_PUBLIC_HONCHO_BASE_URL=... to docker build
# (or use docker-compose `build.args`) so the dashboard ships pointed at your
# Honcho instance. HONCHO_PROXY_BASE_URL / HONCHO_PROXY_ALLOWED_BASES stay
# runtime-only and can be overridden via `-e` flags.
ARG NEXT_PUBLIC_HONCHO_BASE_URL=http://localhost:8000
ARG NEXT_PUBLIC_HONCHO_TOKEN=
ENV NEXT_PUBLIC_HONCHO_BASE_URL=$NEXT_PUBLIC_HONCHO_BASE_URL
ENV NEXT_PUBLIC_HONCHO_TOKEN=$NEXT_PUBLIC_HONCHO_TOKEN
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------- runtime ----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/operator/runtime > /dev/null || exit 1

CMD ["node", "server.js"]

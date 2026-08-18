# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:20-alpine AS deps
WORKDIR /app

# Force development mode to install devDependencies (typescript, tailwind, etc.)
# Coolify may inject NODE_ENV=production which would skip them and break `next build`
ENV NODE_ENV=development

COPY package.json package-lock.json ./
# xlsx مُورَّد محلياً (vendor/) — نسخة SheetJS المُصحّحة غير متاحة على npm
COPY vendor ./vendor
# npm ci — بناء قطعي الاستنساخ من الـ lockfile
# Explicitly include dev deps since next build needs typescript/tailwindcss
RUN npm ci --include=dev --no-audit --no-fund --ignore-scripts

# ============================================
# Stage 2: Build
# ============================================
FROM node:20-alpine AS builder
WORKDIR /app

# Production mode for the actual `next build` (optimized output)
# devDeps are already installed in the deps stage; we just reuse them
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Only NEXT_PUBLIC_* needed at build time (inlined into client bundle)
# Secrets (DATABASE_URL, ENCRYPTION_KEY, BETTER_AUTH_SECRET, CRON_SECRET)
# are runtime-only and injected by Coolify at container start.
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# Placeholders for build-only env checks (auth & encryption are used
# at runtime but some modules read env at import time).
# These are dummy values ONLY used during `next build` — NOT production secrets.
ENV BETTER_AUTH_SECRET=build-placeholder-not-a-real-secret-at-least-32-chars
ENV BETTER_AUTH_URL=$NEXT_PUBLIC_APP_URL
ENV ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
ENV CRON_SECRET=build-placeholder-cron-secret-not-real-at-least-32-chars

RUN npm run build

# ============================================
# Stage 3: Production Runner
# ============================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Next.js standalone output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migration infrastructure — runs in start.sh before server
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/start.sh ./start.sh
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/node_modules/postgres ./node_modules/postgres
RUN chmod +x ./start.sh

USER nextjs

EXPOSE 3000

# Liveness probe — يُرجع 200 إذا الـ app يستجيب (حتى لو DB متعثر مؤقتاً)
# نستخدم Node بدل wget لتجنب الاعتماد على BusyBox tools
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["sh", "./start.sh"]

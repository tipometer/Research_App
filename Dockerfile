# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app

# NODE_ENV=production for Vite frontend optimization.
# esbuild does NOT inline process.env.NODE_ENV by default, so the dev-login
# triple-gate is preserved at runtime. The dev-login-gate.test.ts catches any
# future accidental --define:process.env.NODE_ENV=... bundler flag.
ENV NODE_ENV=production

# corepack enable — pnpm version auto-read from package.json "packageManager"
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- Runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app

# Staging default; Cloud Run --set-env-vars overrides.
ENV NODE_ENV=staging
ENV PORT=8080

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 8080
CMD ["node", "dist/index.js"]

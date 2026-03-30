FROM node:24-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# node-pty needs python + build tools
RUN apk add --no-cache python3 make g++ bash

COPY package.json pnpm-lock.yaml ./

# Install all deps (including devDeps for build)
RUN pnpm install --frozen-lockfile

COPY . .

# Build renderer → out/renderer/public, server → out/server
RUN pnpm build:web

# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# bash for node-pty shell sessions
RUN apk add --no-cache bash

COPY package.json pnpm-lock.yaml ./

# Production deps only — skip postinstall (electron-builder not in prod deps)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=builder /app/out/server ./out/server
COPY --from=builder /app/out/renderer/public/renderer ./out/public/renderer

# Copy pre-built native addon from builder (avoids network fetch in node-gyp)
COPY --from=builder /app/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/build \
    ./node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/build

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "out/server/index.mjs"]

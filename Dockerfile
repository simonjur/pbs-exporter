# syntax=docker/dockerfile:1

# --- dependencies ---------------------------------------------------------
# Install production dependencies only. The app itself runs straight from
# TypeScript via Node 24's native type stripping, so there is no build step.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime --------------------------------------------------------------
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

# Build metadata surfaced by the exporter (overridable at runtime via env).
ARG PBS_BUILD_VERSION=v0.0.0-dev.0
ARG PBS_BUILD_COMMIT=none
ARG PBS_BUILD_TIME=unknown
ENV PBS_BUILD_VERSION=${PBS_BUILD_VERSION} \
    PBS_BUILD_COMMIT=${PBS_BUILD_COMMIT} \
    PBS_BUILD_TIME=${PBS_BUILD_TIME}

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# Build the status-UI frontend into ./public (Vue/Vuetify browser builds + app
# shell). The server requires this directory to exist at runtime.
RUN npm run build:fe

# Run as the unprivileged "nobody" user (matches docker-compose `user: 65534`).
USER 65534

EXPOSE 10019

# Node 24 strips TS types natively, so the TS entrypoint is executed directly.
ENTRYPOINT ["node", "src/run.ts"]

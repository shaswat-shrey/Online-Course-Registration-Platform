# syntax=docker/dockerfile:1.7
# API and worker image (same code, different command). Non-root runtime.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --fetch-retries=5 --fetch-retry-maxtimeout=120000 --workspace @ucrams/shared --workspace @ucrams/api --include-workspace-root

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# prisma.config.ts requires DATABASE_URL even for `prisma generate`, which never connects.
# Build-stage placeholder only; the runtime image gets the real URL from its environment.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    npm run build -w @ucrams/shared && \
    DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build -w @ucrams/api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --fetch-retries=5 --fetch-retry-maxtimeout=120000 \
    --workspace @ucrams/shared --workspace @ucrams/api
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
# Mount point for the local storage driver; a fresh named volume inherits this ownership.
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]

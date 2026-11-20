# syntax=docker/dockerfile:1.7
# Builds the SPA and serves it with unprivileged Nginx, proxying /api and /socket.io.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @ucrams/shared --workspace @ucrams/web --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @ucrams/shared && npm run build -w @ucrams/web

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

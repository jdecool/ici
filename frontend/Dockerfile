FROM node:26.13.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends procps && rm -rf /var/lib/apt/lists/*
RUN npm install --global npm@11.20.0
WORKDIR /workspace/frontend
FROM base AS tools

FROM base AS dependencies
COPY frontend/package*.json ./
RUN npm ci

FROM dependencies AS builder
COPY frontend/ ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31.7-alpine AS production
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=2s --start-period=10s --retries=10 CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

FROM mcr.microsoft.com/playwright:v1.65.0-noble AS e2e
RUN npm install --global npm@11.20.0
WORKDIR /workspace/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
CMD ["npm", "run", "e2e"]

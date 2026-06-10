# syntax=docker/dockerfile:1

FROM node:22.13-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22.13-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22.13-bookworm-slim AS runner
WORKDIR /app

ENV DATA_DIR=/data
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NODE_OPTIONS=--experimental-sqlite
ENV PORT=3000
ENV SQLITE_PATH=/data/garden-ledger.sqlite
ENV UPLOAD_DIR=/data/uploads

RUN mkdir -p /data/uploads && chown -R node:node /data

USER node

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server ./server

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "server/index.mjs"]

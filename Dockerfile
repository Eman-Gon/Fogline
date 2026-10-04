# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY server ./server
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4173
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node server ./server
COPY --chown=node:node src ./src
# Account data lives in Neon (DATABASE_URL). The local file fallback is not durable here.
USER node
EXPOSE 4173
CMD ["node", "--import", "tsx", "server.mjs"]

# Clientforce Temporal worker. Build context = repo root.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "worker..." build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["node", "apps/worker/dist/main.js"]

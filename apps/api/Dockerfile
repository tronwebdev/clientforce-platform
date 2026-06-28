# Clientforce API (NestJS). Build context = repo root.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Builds api + its workspace deps (incl. prisma generate in @clientforce/db).
RUN pnpm --filter "api..." build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=build /app /app
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]

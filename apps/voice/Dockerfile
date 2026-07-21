# Clientforce voice call-session service (P3.1). Build context = repo root.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Builds voice + its workspace deps (incl. prisma generate in @clientforce/db).
RUN pnpm --filter "voice..." build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app /app
EXPOSE 8080
CMD ["node", "apps/voice/dist/server.js"]

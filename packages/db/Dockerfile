# Migration runner — runs `prisma migrate deploy` as a Container Apps Job.
# Build context = repo root. Reads DATABASE_URL (owner) from Key Vault at runtime.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Generates the client + keeps prisma CLI, schema, and migrations available.
RUN pnpm --filter "@clientforce/db..." build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/packages/db
# Apply migrations, then seed defaults (Agency→Workspace→OWNER) so the deployed
# shell has a user to log in with. Seed is idempotent (upserts). T8 expands this.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm db:seed"]

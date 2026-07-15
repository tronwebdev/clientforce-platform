# CLAUDE.md — orientation map for this repo

> A **map, not the territory**. When this file disagrees with anything,
> **`PROGRESS.md` wins** — its Status board and Decision log (the **DEC log**) are
> the live source of truth, updated in the same PR as the work they describe. The
> repo also wins over any copy of a doc outside it (fix forks by PR, never edit
> two places). Treat this file as where to *start*, not where decisions are settled.

**Product.** Clientforce — a multi-tenant, white-label go-to-market SaaS
(**Agency → Workspace → User**), Postgres **RLS** on every `workspaceId` table.
Phase 0–1 (foundation + the email vertical slice) are merged and deployed to
staging; the build has since advanced unit-by-unit well beyond that framing
(guided mode, sequence editor, per-agent rules, sub-campaigns, the platform
backoffice…). **Read `PROGRESS.md` first** for exactly where things stand.

## Canonical docs (read for the area you touch)
- `PROGRESS.md` — Status board · Decision log (DEC-###) · Open questions ·
  Fidelity log · Icon map. The update protocol is `PHASE1_HANDOFF.md §E`.
- `PHASE1_HANDOFF.md` — locked architecture corrections **A1–A12** (still binding).
- `PHASE1_FIDELITY_CHECKPOINTS.md` — per-screen acceptance + the §8 evidence rule.
- `DATA_MODEL.md` — data contracts (schema, event catalog, billing/credits).
  `ARCHITECTURE.md` / `BUILD_PLAN.md` — system design + the phased plan.
- `UI_PORTING_RULES.md` + `DESIGN_TOKENS.md` + `design_handoff_.../prototypes/` —
  port UI from the prototype; atom conflict → token doc wins; composition → prototype wins.
- `KICKOFF_TEMPLATE.md` — standing conventions every unit prompt inherits (DEC-claim
  rule, the send-boundary/no-planner-prompt rails, the ⭑ backoffice-coverage ride-along).
- `CHECKLIST_B1_BACKOFFICE_COVERAGE.md` — the five backoffice spines × surface coverage;
  the reference the ride-along line points at (extend a spine, never a per-feature panel).

## Stack (locked — see handoff §A; don't relitigate)
- **Monorepo:** Turborepo + pnpm, Node 22, TypeScript strict everywhere.
- **Web** (`apps/web`): Next.js 15 + React 19 (App Router). Domain data flows
  through the NestJS API as **REST + zod DTOs** (schemas in `packages/core`); Next
  API routes are auth/session cookies only. No tRPC, no GraphQL.
- **API** (`apps/api`): NestJS 11 modular monolith; dev-JWT auth (Clerk later).
- **Data:** Postgres 16 + pgvector, Prisma. RLS via the `app.workspace_id` GUC +
  the non-superuser `clientforce_app` role — feature queries go through
  `withTenant`, never the owner client. The platform backoffice (and ONLY it) uses
  the dedicated RLS-exempt `clientforce_backoffice` role (BYPASSRLS) — DEC-079.
- **Execution:** Temporal (durable timers/signals) + BullMQ/Redis. Typed,
  **versioned** event catalog in `packages/events` (`email.replied.v1`).
- **AI:** `packages/ai` gateway only — no direct model-SDK imports elsewhere.

## Working agreement
- **One PR per unit; post the plan as the first PR comment**, then update
  `PROGRESS.md` **in the same PR** (protocol: handoff §E). **Claim DEC ids at
  dispatch**, collision-free vs `main`; renumber on collision.
- **BLOCKING** open questions stop that thread — ask the owner step-by-step (the
  owner is non-technical); **NON-BLOCKING** → take the documented default and log it.
- **Every UI PR** carries the §8 set (prototype vs build, 1440×900, full state
  matrix). An internal-only surface with no prototype says so (flagged).
- Secrets live in Azure Key Vault or field-encrypted in the DB — **zero secret
  values in the repo**; `infra/scripts/secret-scan.sh` gates deploy. Never touch
  root-domain mail DNS; product mail is on the `send.` / `reply.` subdomains.
- **Verify before you claim:** run `pnpm build`, `pnpm lint`, `pnpm test`.

## Commands
- `pnpm build` / `pnpm lint` / `pnpm test` — turbo across the workspace.
- `pnpm --filter @clientforce/db db:migrate` · `db:migrate:dev` · `db:seed`.
- `pnpm --filter @clientforce/e2e run e2e` — Playwright (`E2E_BASE_URL`).

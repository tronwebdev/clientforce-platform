# Phase 0 — GitHub Issues (ready to paste)

> Copy each block into a new GitHub issue (the `## Title` is the issue title, the rest is the body).
> Work them **in order, one issue → one PR**. Labels suggested: `phase-0`, `claude-code`.
> Full context: `EXECUTION_PHASE0.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`. Tell Claude Code to post a
> short plan as a comment first, get approval, then implement with tests and open the PR.

---

## T0 · Monorepo bootstrap

**Goal:** stand up the Turborepo skeleton everything else lands in.

**Scope**
- Turborepo + pnpm workspaces.
- Apps: `apps/web` (Next.js), `apps/api` (NestJS), `apps/worker` (Temporal) — stubs that boot.
- Packages: `packages/{core,events,db,tenancy,ui,config}` — empty but importable.
- TypeScript strict everywhere; shared `tsconfig`; ESLint + Prettier; `stylelint` configured to **fail on off-token colors** (per `CONSISTENCY_AUDIT.md`).
- GitHub Actions CI: install → build → lint → test on every PR.

**Acceptance criteria**
- [ ] `pnpm install && pnpm build && pnpm lint` pass locally and in CI.
- [ ] Each app starts (`dev`) without error.
- [ ] CI is green on the PR.

**Out of scope:** real features, DB, auth (later tickets).

---

## T1 · Prisma schema + Postgres + RLS

**Goal:** the full data model with enforced multi-tenant isolation.

**Scope** (implement from `DATA_MODEL.md §1–§7`)
- Prisma schema for tenancy (`Agency → Workspace → User → Membership`), agents/campaigns/graph, contacts/enrollment/pipeline, events, automations, integrations, senders, billing (`Plan`, `CreditLedger`, `CreditPrice`), forms/proposals/widget.
- Enable `pgvector`; `KnowledgeChunk.embedding vector(3072)`.
- Migrations.
- **Row-Level Security policy on every `workspaceId` table**; tenant-scoped Prisma client that sets `app.workspace_id` / `app.agency_id` from request context.

**Acceptance criteria**
- [ ] `prisma migrate` applies cleanly to a real Postgres (with `pgvector`).
- [ ] Test: a query under workspace A returns **zero** rows belonging to workspace B (RLS verified).
- [ ] Seed of the enums/defaults compiles.

**Notes:** money = integer cents; credits = integers; ids = `cuid()`. Agency payouts are **out of scope** (v2).

---

## T2 · Event bus + typed catalog

**Goal:** the backbone every subsystem hangs off (`ARCHITECTURE.md §3c`, `DATA_MODEL.md §5`).

**Scope**
- `packages/events`: typed event constants + payload types, **versioned** (`lead.replied.v1`).
- Persist every event to the `Event` table.
- Publish/subscribe over Redis (BullMQ). Three consumer hooks wired as **no-op stubs**: (1) Temporal-signal, (2) Automations, (3) outbound dispatcher/analytics.

**Acceptance criteria**
- [ ] Emitting `lead.replied.v1` persists an `Event` and invokes all three consumer stubs (unit/integration test).
- [ ] Event payload types are exported and used by a sample publisher.
- [ ] Unknown/invalid event shape is rejected with a clear error.

---

## T3 · API + auth + tenancy middleware

**Goal:** authenticated, tenant-scoped API surface.

**Scope**
- NestJS boots with health check (`/healthz`).
- Auth provider wired (Azure AD B2C / Clerk / Auth0 — pick per provisioning).
- Middleware: resolve user → membership → active workspace + agency; set RLS settings (`app.workspace_id`, `app.agency_id`) per request.
- RBAC guard honoring `Role` (OWNER/ADMIN/AGENT/VIEWER).
- `/me` endpoint returns user + memberships + active workspace.

**Acceptance criteria**
- [ ] Authenticated request to `/me` returns user + memberships; unauthenticated → 401.
- [ ] Switching active workspace changes which rows the API can read (RLS round-trip test).
- [ ] A VIEWER is denied a write endpoint (RBAC test).

---

## T4 · CampaignGraph types + validator + executor skeleton

**Goal:** the planner's output contract + a runnable executor (no real sends yet).

**Scope** (`DATA_MODEL.md §3.1`)
- `packages/core`: TS types for the graph (nodes: step/delay/branch/subcampaign/action/end; conditional edges).
- **zod validator** for the graph.
- Pure, unit-tested **executor** that walks nodes/edges and emits "intended actions" (a log of what *would* happen), including delay + branch resolution given a mocked event.

**Acceptance criteria**
- [ ] A valid sample graph executes to completion in tests, producing the expected ordered intended-actions.
- [ ] An invalid graph (bad node ref, missing entry, unknown channel) is rejected with a precise error.
- [ ] Branch nodes resolve correctly for `interested` / `not_now` / `default` intents (test).

---

## T5 · Design system foundation

**Goal:** the token system as React components (`CONSISTENCY_AUDIT.md`).

**Scope**
- `packages/ui`: tokens (Bricolage Grotesque + Hanken Grotesk; `#35E834`; radius/shadow/spacing scales) as a theme + base components: Button, Card, Pill, Dropdown, Toast, Tab, Toggle.
- Storybook (or a sample route) rendering them.

**Acceptance criteria**
- [ ] Components render on-token; `stylelint` passes (no off-token colors).
- [ ] Light review against the prototype catalog confirms visual match.

---

## T6 · Web shell

**Goal:** logged-in app shell to host every subsystem.

**Scope**
- `apps/web` (Next.js): login flow, app shell + sidebar nav matching the prototype, workspace switcher (agency users can switch client workspaces), top bar.
- Wired to `/me`; route guards by auth + role.

**Acceptance criteria**
- [ ] Log in → land on the shell with sidebar.
- [ ] Switching workspace updates tenant context and visible data.
- [ ] Unauthorized routes redirect to login.

---

## T7 · Infrastructure as code + deploy

**Goal:** reproducible cloud env + CD.

**Scope** (provisioning list in `EXECUTION_PHASE0.md §A`)
- `infra/` Bicep or Terraform: Postgres Flexible Server (+pgvector), Azure Cache for Redis, Blob, Container Registry, Container Apps env; Temporal Cloud namespace wired; secrets via Key Vault.
- GitHub Actions: build → push image → deploy `api`/`worker`/`web` to Container Apps; run migrations.

**Acceptance criteria**
- [ ] Merge to `main` deploys to staging automatically.
- [ ] The deployed web shell logs in against the cloud DB; migrations applied.
- [ ] Secrets resolved from Key Vault (none in repo).

---

## T8 · Seed + smoke

**Goal:** a usable seeded environment + end-to-end confidence.

**Scope**
- Seed script: one Agency → one Workspace → one User (OWNER) → sample Agent + default PipelineStages (`New → Contacted → Engaged → Interested → Booked → Won → Lost`) + seed `CreditPrice` rows (market-rate + markup) + the 3 `Plan` tiers.
- e2e smoke test: login → see shell → read seeded agent under RLS.

**Acceptance criteria**
- [ ] Fresh env seeds in one command.
- [ ] Smoke test passes in CI against a disposable DB.
- [ ] Default pipeline stages + credit prices present and editable.

---

### Definition of done — Phase 0
A deployed app you log into, real Postgres with RLS, the event bus alive with its three consumers, the
CampaignGraph executor unit-tested, and a seeded tenant. → proceed to **BUILD_PLAN Phase 1** (the email
vertical slice).

# Phase 0 — Execution Pack (Claude Code tickets + environment)

> Hand these to Claude Code **one ticket = one PR**, in order. Each has acceptance criteria so the
> agent (and you) know when it's done. Phase 0 ends with a deployed, logged-in shell on real infra,
> ready for the Phase-1 vertical slice. Reference `DATA_MODEL.md` and `ARCHITECTURE.md` throughout.

---

## A. Provisioning checklist (do before / alongside ticket 1)
External accounts & resources the build needs. Most you already have — confirm and capture secrets.

**Cloud / infra (Azure unless noted):**
- [ ] Azure subscription + resource group (`clientforce-prod`, `clientforce-staging`)
- [ ] Azure Database for **PostgreSQL Flexible Server** (enable `vector` / `pgvector` extension)
- [ ] **Azure Cache for Redis**
- [ ] **Azure Blob Storage** account + containers (`uploads`, `recordings`, `proposal-assets`)
- [ ] **Azure Container Registry** + **Container Apps** environment
- [ ] **Temporal Cloud** account → namespace + mTLS cert (cloud-agnostic; not an Azure service)
- [ ] Decision: **voice region** — measure Twilio↔model latency; may differ from the platform region

**AI / voice:**
- [ ] **Anthropic** API key (Claude)
- [ ] Embeddings provider key (OpenAI `text-embedding-3-large` or Voyage)
- [ ] **Deepgram** key (STT) · **ElevenLabs or Cartesia** key (TTS) — needed at Phase 3, set up early

**Channels / money:**
- [ ] **SendGrid** account → API key, plan supporting **subusers** + **dedicated IPs** (one IP/warmup per tenant tier); verify a sending domain (SPF/DKIM/DMARC)
- [ ] **Twilio** account → SMS + WhatsApp sender + Voice numbers, Media Streams enabled
- [ ] **Stripe** account → keys + webhook signing secret (billing/credits + proposal payments)

**Auth & ops:**
- [ ] Auth provider — **Azure AD B2C / Clerk / Auth0** (pick one; supports orgs/RBAC)
- [ ] **Sentry** project + **OpenTelemetry** collector endpoint
- [ ] GitHub repo `clientforce-platform` + Claude Code connected; secrets in GitHub Actions + Key Vault

> Store everything in **Azure Key Vault**; reference by name in env. Never commit secrets.

---

## B. Phase-0 tickets (one PR each)

**T0 — Monorepo bootstrap**
- Turborepo + pnpm; `apps/{web,api,worker}` + `packages/{core,events,db,tenancy,ui,config}` stubs.
- TypeScript strict, ESLint + Prettier, `stylelint` (fail on off-token colors per `CONSISTENCY_AUDIT.md`).
- ✅ `pnpm build` + `pnpm lint` pass; CI runs them on PR.

**T1 — Prisma schema + RLS** *(from `DATA_MODEL.md §1–§7`)*
- Generate schema; enable `pgvector`; migrations; **RLS policy on every `workspaceId` table**.
- Tenant-scoped Prisma client that sets `app.workspace_id` / `app.agency_id`.
- ✅ Migrate to a real Postgres; a cross-workspace query returns zero rows under RLS (test).

**T2 — Event bus + catalog** *(`DATA_MODEL.md §5`)*
- `packages/events`: typed event constants + payload types; `Event` persistence; publish/subscribe over
  Redis (BullMQ) with three consumer hooks (Temporal-signal, automations, dispatcher) as no-op stubs.
- ✅ Emitting `lead.replied.v1` persists an Event and invokes all three consumer stubs (test).

**T3 — API + auth + tenancy**
- NestJS boots; health check; auth provider wired; middleware resolves user → membership →
  workspace/agency context and sets RLS settings per request; RBAC guard.
- ✅ Authenticated request to `/me` returns user + memberships; unauthenticated is 401.

**T4 — CampaignGraph types + validator + executor skeleton** *(`DATA_MODEL.md §3.1`)*
- `packages/core`: TS types for the graph; **zod validator**; a pure, unit-tested executor that walks
  nodes/edges and emits "intended actions" (no real sends yet).
- ✅ Valid graph executes to completion in tests; invalid graph is rejected with clear errors.

**T5 — Design system foundation** *(`CONSISTENCY_AUDIT.md`)*
- `packages/ui`: tokens (Bricolage + Hanken, `#35E834`, scales, shadows) as React components/theme.
- ✅ A Storybook (or sample page) renders Button/Card/Pill/Toast on-token.

**T6 — Web shell**
- `apps/web` (Next.js): login, app shell + sidebar nav matching the prototype, workspace switcher.
- ✅ Log in → see the shell; switching workspace changes tenant context.

**T7 — Infra as code + deploy**
- `infra/` Bicep/Terraform for the §A resources; GitHub Actions build → push → deploy to Container Apps;
  Temporal Cloud wired; secrets from Key Vault.
- ✅ `main` deploys; the live shell logs in; migrations applied in cloud.

**T8 — Seed + smoke**
- Seed: Agency → Workspace → User(OWNER) → sample Agent + default PipelineStages; e2e smoke test.
- ✅ Fresh env seeded; smoke passes in CI.

> **Definition of done for Phase 0:** a deployed app you log into, real Postgres+RLS, the event bus
> alive, the graph executor unit-tested — i.e. the skeleton the Phase-1 email slice plugs straight into.

---

## C. How to run it with Claude Code
1. Connect Claude Code to `clientforce-platform`; point it at this folder (`agent_platform_build/`) + `DATA_MODEL.md`.
2. Open T0…T8 as GitHub issues (copy the blocks above). Tell Claude Code to take **one issue → one PR**.
3. Review each PR against its ✅ criteria; merge behind a feature flag where relevant.
4. After T8, proceed to **BUILD_PLAN Phase 1** (the email vertical slice) — its tickets are §"First tasks" there.

> Tip: have Claude Code post a short plan in each issue before coding; approve, then let it implement +
> open the PR with tests. Keep PRs small — it self-corrects far better than on a giant change.

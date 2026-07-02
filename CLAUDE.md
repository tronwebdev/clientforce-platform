# CLAUDE.md — standing instructions for this repo

Clientforce AI agent platform — a multi-tenant, white-label go-to-market SaaS
(**Agency → Workspace → User**, Postgres RLS on every `workspaceId` table).
Phase 0 (T0–T8) is merged and deployed to staging; Phase 1 is the **email
vertical slice**, run as one end-to-end milestone (`PHASE1_HANDOFF.md §B`).

## Canonical docs (the repo is the single source of truth)

If any copy of a doc outside this repo disagrees with the repo, **the repo
wins**; fix forks by PR, never by editing two places.

Read before building, in this order:

1. `PHASE1_HANDOFF.md` — locked architecture corrections (A1–A12), milestone
   demo script (§B), UI plan (§C), PROGRESS protocol (§E), owner-confirmed
   demo config (§G). Supersedes `P1.8_UI_WIRING_NOTES.md`.
2. `PHASE1_FIDELITY_CHECKPOINTS.md` — binding per-screen acceptance criteria.
3. `PHASE1_ISSUES.md` — workstreams P1.1–P1.7 (as amended by the handoff §B).
4. `DATA_MODEL.md` — the keystone data contracts (amended per handoff §A6–A9).
5. `UI_PORTING_RULES.md` — port UI from the prototype files; never reconstruct.
6. `PHASE0_REAUDIT.md` — why each correction exists (context, not tasks).

Prototypes live in `design_handoff_clientforce_restyle/prototypes/` and are
the binding source for every screen's structure, states, interactions, exact
values, and copy. `DESIGN_TOKENS.md` governs the atoms; the prototype governs
the composition. Atom conflict → token doc wins (flag it); composition/behavior
→ prototype wins.

> Brand vs product UI: any Sora/IBM-Plex-era collateral is marketing/brand
> only. Product UI is Direction E — Bricolage Grotesque + Hanken Grotesk,
> `#35E834`, warm `#FBF7F0` canvas — as tokenized in `packages/ui`.

## Stack (locked — handoff §A, don't relitigate)

- **Monorepo:** Turborepo + pnpm, Node 22, TypeScript strict everywhere.
- **Web:** `apps/web` Next.js 15 + React 19 (App Router). **A2:** all domain
  data flows through the NestJS API as **REST with zod-typed DTOs** (schemas in
  `packages/core`, one typed client, TanStack Query client-side). Next.js API
  routes are for auth/session cookies **only** — never domain data. No tRPC,
  no GraphQL.
- **API:** `apps/api` NestJS 11 modular monolith. Auth: dev-JWT accepted for
  Phase 1 (**A3**); provider decided = Clerk, integrated as its own unit later.
- **Data:** Postgres 16 + pgvector, Prisma, RLS via `app.workspace_id` GUC and
  the non-superuser `clientforce_app` role — feature queries go through the
  RLS-subject client (`withTenant`), never the owner client.
- **Execution:** Temporal (durable timers, reply signals, branching);
  BullMQ/Redis for fast fan-out jobs; typed event catalog in `packages/events`
  — event names are **versioned** (`email.replied.v1`), `lead.replied` is
  removed (**A9**).
- **AI:** `packages/ai` gateway only — no direct Anthropic SDK imports
  elsewhere. Opus-class for planning, Sonnet-class for copy/classification.
- **Realtime (A4):** TanStack Query polling (5s on Inbox/Logs/open lead
  drawer). No WebSockets in Phase 1.
- **Domain mapping (A5):** one agent = one goal = one auto-created primary
  campaign; routes `/agents/[agentId]/[tab]`, tab ∈
  `inbox|steps|leads|settings|logs` (+ inert `calls|preview|stats`).
- **Models added in Phase 1 (A6/A7):** `Message` (every outbound persisted as
  rendered at send time; every inbound + intent) and `Suppression` (checked at
  the send boundary together with `Contact.optOut`). Guardrails follow the
  typed schema in **A8** — `unsubscribeFooter` and `suppressionCheck` are
  literal `true`, never disableable.
- **Icons (A11):** `lucide-react`; the prototype glyphs are placeholders — map
  once in PROGRESS.md's icon table and reuse verbatim.
- **Fidelity (A12):** the prototype's literal values are the acceptance
  standard; do not silently normalize to "recommended ramps".

## Working agreement

- **One PR per unit; post the plan as the first PR comment before
  implementing.** Update `PROGRESS.md` **in the same PR** as the work it
  describes (protocol in handoff §E: Status, Decision log, Open questions,
  Fidelity log, Icon map).
- **BLOCKING open questions stop that thread** — record in PROGRESS.md and ask
  the owner; NON-BLOCKING → take the documented default and log it. The owner
  is non-technical: any instruction to them must be step-by-step, assuming no
  dev knowledge, saying exactly where to click.
- **Every UI PR** carries the checkpoints §8 screenshot set: prototype next to
  build at 1440×900, full state matrix (default/skeleton/empty/error/overlays
  open/each tab-segment), stateful controls closed *and* open. Never mark a
  checkpoint passed without rendering both and comparing.
- Secrets live in Azure Key Vault (platform) or field-encrypted in the DB
  (per-tenant) — zero secret values in the repo; `infra/scripts/secret-scan.sh`
  gates every deploy. Root-domain mail DNS (`clientforce.io` MX / SPF on `@`)
  is production infrastructure — never touch it or instruct anyone to; product
  mail lives on the `send.` / `reply.` subdomains (handoff §G).
- Verify before you claim: run `pnpm build`, `pnpm lint`, `pnpm test` locally;
  CI runs them plus the deploy pipeline (secret-scan → OIDC → preflight →
  build → Bicep → migrate+seed → smoke → Playwright e2e vs staging).

## Commands

- `pnpm build` / `pnpm lint` / `pnpm test` — turbo across the workspace.
- `pnpm --filter @clientforce/db db:migrate` (deploy) · `db:migrate:dev` ·
  `db:seed` (idempotent; re-run safe).
- `pnpm --filter @clientforce/e2e run e2e` — Playwright (`E2E_BASE_URL`
  targets a deployed or local web).
- Local stack: Postgres 16 + pgvector + Redis; `apps/api` on :3001,
  `apps/web` on :3000 (`API_URL`, `AUTH_DEV_SECRET` must match the API).

# Phase 1 — GitHub Issues (ready to paste)

> **The email vertical slice** — the first phase where the agent actually does something real:
> ingest knowledge → distill context → Claude plans a campaign → execute it on a durable Temporal
> workflow → send email → catch the inbound reply → classify intent → signal the workflow → branch →
> move the pipeline. End state: a real lead receives a real email, replies, and the agent branches the
> journey and advances the pipeline **automatically**.
>
> Prereq: **Phase 0 (T0–T8) merged.** Same loop: one issue → one PR, plan-comment first, watch CI,
> you merge. Labels: `phase-1`, `claude-code`. Context: repo-root `ARCHITECTURE.md` + `DATA_MODEL.md`
> + the prototypes in `design_handoff_clientforce_restyle/prototypes/`.
>
> **Provider keys this phase needs** (team supplies on request): **Anthropic** (planner + classifier),
> **SendGrid** (subuser + a sending domain with SPF/DKIM/DMARC; inbound parse webhook), **embeddings**
> provider (OpenAI `text-embedding-3-large` at **1536 dims** so the vector column can take a real index —
> see T1's phase-1 TODO). Use sandbox/test creds until the live-send ticket (P1.8).

---

## P1.1 · LLM gateway (`packages/ai`)

**Goal:** one swappable interface to Claude for every AI task; never call the SDK directly elsewhere.

**Scope**
- `packages/ai`: a thin gateway over the Anthropic SDK (Vercel AI SDK optional) exposing typed
  `complete()` / `completeStructured(schema)` (zod-validated structured output) / `embed()`.
- Per-task model routing: **Opus-class for planning**, **Sonnet-class for copy/classification** (config-driven).
- Prompt registry (versioned prompt templates), token/cost logging, retry w/ backoff, timeout, and a
  hard JSON-repair/`reject` path for malformed structured output.
- Unit tests with a **mocked** provider (no network in CI).

**Acceptance criteria**
- [ ] `completeStructured` returns a typed object that passes its zod schema; a malformed model reply is rejected with a clear error (tested with a mock).
- [ ] Model routing picks the configured model per task.
- [ ] No other package imports the Anthropic SDK directly (lint/grep check).

---

## P1.2 · Knowledge ingestion + RAG (`packages/knowledge`)

**Goal:** turn a URL/doc into embedded, retrievable chunks (`DATA_MODEL.md §2`).

**Scope**
- Ingest a `KnowledgeSource` (website fetch + readability extract; plain doc/text) → clean → **chunk** →
  `embed()` via `packages/ai` → store `KnowledgeChunk` rows (embedding **1536-dim**).
- Add the **hnsw index** on the vector column now that dims fit (resolves T1's `TODO(phase-1)`).
- `retrieve(workspaceId, query, k)` → top-k chunks via cosine distance (tenant-scoped through `withTenant`).
- Ingestion runs as a job (BullMQ) with `IngestStatus` transitions PENDING→INGESTING→READY/FAILED.

**Acceptance criteria**
- [ ] Ingesting a sample page produces READY chunks with embeddings; FAILED on a dead URL.
- [ ] `retrieve` returns relevant chunks for a query, scoped to the workspace (RLS round-trip test).
- [ ] hnsw index exists and is used (EXPLAIN shows index scan).

---

## P1.3 · Business Context distiller

**Goal:** the agent "reads the company first" — distill knowledge → a structured `BusinessContext`.

**Scope** (`DATA_MODEL.md §2`)
- Given an agent + its knowledge, use `packages/ai` `completeStructured` to produce `BusinessContext`
  (offer, ICP, proof points, tone, constraints, rawSummary) and persist it (one per agent).
- Re-distills when knowledge changes; exposes it to the planner.

**Acceptance criteria**
- [ ] Running the distiller on a seeded agent writes a `BusinessContext` matching the schema.
- [ ] Re-running after adding a source updates it.
- [ ] Output is grounded — constraints/claims reflect the ingested content (spot-check test with a fixed fixture).

---

## P1.4 · Planner → CampaignGraph

**Goal:** goal + context → a valid, runnable `CampaignGraph` (`DATA_MODEL.md §3.1`).

**Scope**
- Planner prompt: inputs = agent goal + `BusinessContext` + allowed channels (**email only** this phase) +
  guardrails; output = a `CampaignGraph` via `completeStructured`, **validated by the T4 zod validator**.
- Persist as `CampaignGraph` v1 (`source: AI`). Reject + repair-or-fail on invalid graphs (never store an invalid one).
- For this slice the graph is a short email sequence with at least one **delay** and one **branch on reply**.

**Acceptance criteria**
- [ ] Planning a seeded agent yields a graph that passes the validator and round-trips through the executor (T4) in dry-run.
- [ ] An intentionally broken model output is caught and never persisted.
- [ ] Tokens (`{{firstName}}`, `{{company}}`) appear in step content.

---

## P1.5 · Email channel adapter (`packages/channels`) + `SenderConnection` model

**Goal:** a real outbound email send behind a pluggable, **multi-provider** sender abstraction.

**The three-tier sender model (logic — build the abstraction now, providers incrementally):**
A workspace has one or more `SenderConnection` rows. The adapter sends through whichever the campaign
uses, agnostic to provider:
- **`CF_MANAGED` (Clientforce Mailer)** — sends via our SendGrid parent account. Two sub-modes on the
  same row: **shared pool** (default, zero-setup) and **dedicated IP** (upgrade → own SendGrid subuser +
  dedicated IP, reserved field `dedicatedIp` / `ipPoolId`). Always available as a pick.
- **`GMAIL_OAUTH` / `OUTLOOK_OAUTH`** — send as the user's own mailbox via OAuth (send-only scope).
- **`SMTP`** — custom host/credentials.
> `CF_MANAGED` is always a valid connection type for every workspace; the others are additive, not
> replacements. The user **picks one** at connect time (mirrors the prototype `cfmailer|gmail|outlook|smtp`).

**Credential handling (important):** platform secrets (SendGrid parent key, Google/MS OAuth *app*
secrets, webhook verification key) come from **Key Vault**. **Per-tenant** credentials (each workspace's
OAuth refresh token, SMTP password, subuser key) are stored **encrypted in the DB** using the
`FIELD-ENCRYPTION-KEY` master key from Key Vault — never in Key Vault, never plaintext.

**Scope (this phase ships the abstraction + ONE concrete provider to first live send):**
- `SenderConnection` schema with `type`, encrypted-credential columns, `dailyLimit`/sending window,
  domain-auth status, and reserved `warmupState`/`dedicatedIp` fields (so later tiers don't need a refactor).
- Adapter interface (`send(step, lead, sender) → providerMessageId`) with the **`CF_MANAGED` (SendGrid,
  shared pool)** implementation first — fastest clean path to an end-to-end send we control.
  `GMAIL_OAUTH`/`OUTLOOK_OAUTH`/`SMTP`/dedicated-IP are thin follow-on implementations of the same interface.
- Token rendering (`{{firstName}}` etc.) against the contact at send time.
- Guardrails at the boundary: sending window, daily cap, **suppression/opt-out check**, unsubscribe header/link.
- Inbound + event webhooks (delivered/open/click/bounce/spam/reply) **received and normalized** (wired to
  the event bus in P1.7). SendGrid sandbox mode until P1.8.

**Acceptance criteria**
- [ ] `SenderConnection` model supports all four `type`s (only `CF_MANAGED` shared has a live send this phase); per-tenant creds are encrypted at rest.
- [ ] Sending a rendered step via `CF_MANAGED` returns a provider message id (sandbox); tokens resolved; unsubscribe present.
- [ ] An opted-out contact is **not** sent to (tested).
- [ ] Webhook payloads parse into normalized internal shapes (unit test with sample SendGrid payloads).
- [ ] Adapter interface is provider-agnostic — adding a second provider needs no change to the workflow/executor.

---

## P1.6 · CampaignWorkflow (Temporal) — real execution

**Goal:** the durable per-lead engine that runs the graph (the keystone, now real).

**Scope** (`ARCHITECTURE.md §3.1`)
- Temporal `CampaignWorkflow` (one per `Enrollment`): walks the `CampaignGraph` using the T4 executor;
  **`delay` nodes = Temporal timers**; **`step` nodes = activities** calling the email adapter (P1.5);
  `branch` nodes **await a signal** (the classified reply from P1.7) then route.
- Activities are idempotent + retried with backoff. Workflow id stored on `Enrollment.workflowId`.
- Enrolling a contact starts a workflow; pipeline stage + `currentNode` persisted as it advances.

**Acceptance criteria**
- [ ] Enroll a contact → workflow sends step 1, waits a (shortened-for-test) delay, sends step 2.
- [ ] Sending a `reply` signal at a branch routes to the correct path (integration test against a local Temporal).
- [ ] Killing/restarting the worker mid-run resumes correctly (durability check).

---

## P1.7 · Inbound → classify → signal (close the loop)

**Goal:** a reply becomes a typed event, gets an intent, and branches the lead's workflow.

**Scope** (`DATA_MODEL.md §5`)
- SendGrid inbound/event webhook → normalize → emit `email.replied.v1` (and delivered/open/bounce) to the
  **event bus** (T2), persisting `Event` rows.
- Reply consumer: classify intent with `packages/ai` (`interested | not_now | objection | unsubscribe | other`),
  attach to the event, then **signal** the matching `Enrollment`'s workflow.
- Pipeline + unsubscribe side-effects: `lead.stage_changed`, `lead.unsubscribed` emitted; opt-out honored.
- **Engagement awareness (foundational):** opens/clicks/bounces from P1.5 are persisted as `Event` rows
  on the lead **and made available to the agent's decision context** — not just the reply. At a branch
  node the planner/classifier sees the lead's recent engagement signal (opened twice, clicked, went
  cold), so "the agent is aware of every captured activity" holds from day one. (Proposal-open / payment
  events join the same stream in later phases — see carried-forward note.)

**Acceptance criteria**
- [ ] A simulated inbound reply produces a persisted `email.replied.v1` with a classified `intent`.
- [ ] The matching workflow receives the signal and branches (end-to-end test: enroll → send → reply → branch → stage change).
- [ ] An "unsubscribe" reply sets opt-out and stops the workflow.

---

## P1.8 · Wire the UI + live send (vertical slice end-to-end)

**Goal:** drive the whole slice from the real app, on real infrastructure.

**Scope**
- Wire the **Create-Agent** flow (goal + knowledge), the **Steps** view (show the planned graph), and the
  **Campaign View → Leads/Inbox** to the API — reusing the prototype screens (restyled, `packages/ui`).
- Enroll a real test contact; flip SendGrid out of sandbox for an allow-listed address; verify a real email
  arrives, reply, and watch the lead branch + advance in the UI.
- Observability: the run is visible (events timeline / logs) in the UI.

**Acceptance criteria**
- [ ] From the UI: create agent → ingest a page → plan → enroll a test lead → real email arrives.
- [ ] Replying to that email branches the journey and moves the pipeline stage, visible in the UI.
- [ ] The events timeline shows the full sequence.

---

### Carried forward (design now, build later) — keep these abstractions clean
These are **not** Phase-1 deliverables, but P1.5's adapter and P1.7's event stream should be shaped so they
drop in without refactoring:
- **Action/tool registry** — email-send is the first entry in a general **action catalog** the agent can
  invoke (later: send proposal, payment link, booking link, arbitrary integration action). Build the P1.5
  email adapter as *one implementation of a tool interface*, not a bespoke email-only path, so Phase 2+
  tools register into the same surface that both the rules engine and the agent draw from.
- **Unified event awareness** — every action emits result events (sent/opened/clicked → later
  proposal.opened / payment.completed / booking.made) onto the **same bus**, all flowing into the agent's
  context. The agent's loop is *goal + knowledge → plan → act (via tools) → observe (events) → re-plan*;
  Phase 1 builds the email-shaped version of exactly that loop.

---

### Definition of done — Phase 1
A real agent, built in the UI, reads a company's site, plans an email sequence, sends it on a durable
Temporal workflow, and — when the lead replies — classifies the intent, branches, and moves the pipeline,
all visible in the app. **This is the product's heartbeat working end-to-end on one channel.**
→ Phase 2 adds SMS/WhatsApp/voice on the same spine, then the subsystems (BUILD_PLAN Phases 6–10).

---

### Suggested review focus (the risky bits)
- **P1.4 planner discipline** — the graph must be validator-gated; never persist/run an invalid one.
- **P1.6 durability** — the restart-resumes test is the proof Temporal is earning its place.
- **P1.7 the loop** — the enroll→send→reply→branch→stage end-to-end test is the single most important test in the phase; review it hard.
- **Deliverability** — domain auth (SPF/DKIM/DMARC) + opt-out are non-negotiable before any live send (P1.8).

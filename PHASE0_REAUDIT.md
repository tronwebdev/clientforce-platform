# Phase-0 Re-audit — before any Phase-1 code

> Fresh-eyes review of the architecture + handoff docs against (a) the current prototypes and
> (b) the **actual merged repo state** of `tronwebdev/clientforce-platform@main` (verified directly:
> `apps/web` = Next.js 15 + React 19, App Router, dev-JWT auth via `jose`; `packages/ui` = tokens +
> 7 components; stylelint token gate present).
>
> Ranked by **how expensive the issue becomes if Phase 1 is built on top of it**.
> Every fix lands in `PHASE1_HANDOFF.md` (the corrected brief) — this file is the evidence trail.

---

## P0 — resolve BEFORE writing Phase-1 code (retrofit cost: severe)

### 1. There is no Message model — the Inbox has nowhere to read from
**Evidence:** `DATA_MODEL.md §4–§5` has `Contact`, `Enrollment`, `Event` — no `Message`/thread entity.
P1.7/P1.8 require an **Inbox with threads** (grouped by intent), a **lead timeline with message
bodies**, and compliance-grade records of what was actually sent.
**Why it's expensive:** `Event` rows are a fan-out contract, not a message store. If P1.8 renders the
Inbox off event payloads, we retrofit a `Message` table *after* live sends — a data migration plus a
rewrite of Inbox, lead drawer, and Logs, and until then no durable record of rendered outbound copy
(compliance risk).
**Fix:** add `Message` (direction, channel, subject/body as rendered, providerMessageId, inReplyTo,
enrollmentId, contactId) — persisted on every send (P1.5) and on every inbound (P1.7). Spec in
`PHASE1_HANDOFF.md §A6`.

### 2. No Suppression model — opt-out enforcement has no source of truth
**Evidence:** `Contact.optOut Json` is the only opt-out surface in the data model, but the Settings
prototype ships a **workspace-level Suppression list** (address, reason, source), and
`P1.8_UI_WIRING_NOTES §E` says "wire the suppression list as the enforcement source" — against a
model that doesn't exist.
**Why it's expensive:** compliance-critical (CAN-SPAM/CASL per D7). Retrofitting a suppression ledger
after live sends means you can't prove past enforcement.
**Fix:** `Suppression` table + adapter-boundary check in P1.5. Spec in `PHASE1_HANDOFF.md §A7`.

### 3. Agent ↔ Campaign ↔ Graph mapping to the UI is unspecified
**Evidence:** `DATA_MODEL.md §3`: `Agent 1—N Campaign 1—N CampaignGraph(version)`. The prototypes
speak **only of "Agents"** — Agents List rows, Create Agent wizard, one agent view with tabs. Nothing
says what the wizard actually creates, what an Agents List row aggregates, or what URL an agent view
lives at when an agent has 2 campaigns.
**Why it's expensive:** this decides routes, queries, and the wizard's write path. A wrong guess
ships URLs and list semantics that every later phase (sub-campaigns, stats, automations) builds on.
**Fix (decided):** v1 rule = **1 agent : 1 auto-created primary campaign**; routes
`/agents/[agentId]/[tab]`; sub-campaigns deferred. Full rule in `PHASE1_HANDOFF.md §A5`.

### 4. The API + data-fetching contract was never locked — three docs say three things
**Evidence:** `ARCHITECTURE.md §3` diagram says "tRPC/GraphQL"; T3 built a REST-ish NestJS `/me`;
`ARCHITECTURE.md §2.6` says "TanStack Query + Zustand" (neither is installed in `apps/web`);
`P1.8_UI_WIRING_NOTES §C` says "Server Components fetch; **mutations via API routes**" — which reads
as *Next.js* API routes, bypassing the NestJS API entirely.
**Why it's expensive:** Claude Code will produce a mixed protocol (some data through Next routes,
some through NestJS) and every screen wired in P1 hard-codes the guess.
**Fix (decided):** NestJS REST + zod DTOs in `packages/core`, one typed client, TanStack Query in
client components; Next.js API routes are for auth/session cookies **only**. `PHASE1_HANDOFF.md §A2`.

### 5. `P1.8_UI_WIRING_NOTES.md` is stale against the current prototypes — and it's the binding UI doc
**Evidence (checked against the prototype source):**
- Notes describe a **5-step** wizard ending in "Channels & senders". The prototype
  (`Create Agent.dc.html`, step defs ~line 1709) now has **6 steps**: *Set the goal → Design
  sequence → Add contacts → Enable lead capture → **Guardrails & compliance** → **Preview &
  launch***. "Channels & senders" now lives **inside Guardrails**; a Preview/summary step exists;
  step titles/copy changed ("Setup Agent" → "Set the goal").
- Notes list **7 Campaign View tabs**; the prototype has **8** (`Preview` is missing from the notes
  entirely — not even on the defer list). `ARCHITECTURE.md §3a` lists 6.
**Why it's expensive:** Claude Code following the notes builds the wrong wizard shape — the single
most complex Phase-1 screen — then rebuilds it after review.
**Fix:** `PHASE1_HANDOFF.md` supersedes the notes; wizard/tab specs regenerated from the prototypes;
`UI_PORTING_RULES.md`'s "port from the prototype file" stays the tie-breaker rule.

### 6. `Agent.guardrails Json` is unstructured — exactly when guardrails became a first-class wizard step
**Evidence:** the prototype's new step 5 collects sending window, daily caps, consent confirmations,
compliance toggles; Settings has "Tracking & compliance" toggles; P1.5/P1.6 must **enforce** these at
the send boundary. The model gives Claude Code a bare `Json` to invent a shape for.
**Why it's expensive:** the guardrails shape is read by the planner, the adapter, and the workflow —
changing it later touches all three plus persisted rows.
**Fix:** zod-typed `Guardrails` schema now (`PHASE1_HANDOFF.md §A8`).

---

## P1 — decide at Phase-1 kickoff (compounding cost)

### 7. Phase 1 has no entry point: Agents List and the landing page are in nobody's scope
**Evidence:** P1.8 wires Create Agent, Campaign View, Contacts, Settings→Channels — but the demo
script starts "From the UI: create agent…" and nothing wires the **Agents List** (the New-agent CTA,
row → agent view) or defines what login lands on (`apps/web/app/(shell)/page.tsx` is a placeholder).
**Fix (decided):** login lands on `/agents`; Agents List gets a minimal-but-real wiring (list, search,
status filter, create CTA, row nav); Dashboard stays an inert stub with a designed empty state.

### 8. Event naming is inconsistent across the three docs that define it
**Evidence:** T2 acceptance uses `lead.replied.v1`; P1.7 uses `email.replied.v1`; the
`DATA_MODEL.md §5` catalog lists **both** `email.replied` and `lead.replied` (unversioned) without
defining their relationship or which one signals the workflow.
**Why it matters:** event names ossify — Phase 6 automations and Phase 7 webhooks/Zapier subscribe to
them. **Fix:** versions mandatory; `lead.replied` dropped (a reply is always channel-specific);
canonical P1 set in `PHASE1_HANDOFF.md §A9`.

### 9. Contacts segments don't map to the pipeline
**Evidence:** prototype segments = All / New / Replied / **Qualified** / Booked / Unsub. Decided
stages (D5) = New → Contacted → Engaged → Interested → Booked → Won → Lost. "Replied" and
"Qualified" aren't stages; "Unsubscribed" is an opt-out state, not a stage. The notes hand-wave
"map these to PipelineStage".
**Fix:** segments are **queries**, not stages — mapping table in `PHASE1_HANDOFF.md §A10`
(one open question logged: whether "Qualified" chip should read "Interested").

### 10. Shared-component debt: `packages/ui` has 7 atoms; Phase 1 needs ~10 more composites
**Evidence:** repo has Button/Card/Dropdown/Pill/Tabs/Toast/Toggle. Phase-1 screens need **AppDrawer**
(3 uses), **Modal**, **DataTable** (3 tables share header/row/checkbox/bulk-bar anatomy),
**SegmentTabs**, **BulkBar**, **ChannelChip**, **Stepper**, **Skeleton**, **EmptyState**. The
CONSISTENCY_AUDIT exists *because* copy-pasted drawer shells drifted (the serif-font bug).
**Fix:** build these once in `packages/ui` as the first P1.8 work unit (`PHASE1_HANDOFF.md §C1`).

### 11. Auth is a dev stub and no provider was ever picked
**Evidence:** docs say "Azure AD B2C / Clerk / Auth0 — pick one"; what shipped is a `jose` dev-JWT +
`AUTH-DEV-SECRET` + dev-login route.
**Fix:** explicitly **accept dev-auth for Phase 1** (feature-flagged), and make the provider choice a
tracked decision due before any external demo — the Onboarding/login screens can't be finaled until
then. Logged as an open question in the PROGRESS protocol.

### 12. Realtime strategy undecided, but P1 acceptance says "watch the lead branch in the UI"
**Evidence:** `ARCHITECTURE.md §2.5` says "WebSockets … or Azure Web PubSub"; nothing picked; P1.8
acceptance implies live updates. **Fix (decided):** P1 = TanStack Query polling (5s on Inbox/Logs/
lead drawer); WebSockets deferred. Cheap, testable, no throwaway.

### 13. No component decomposition exists anywhere (the "boundaries" gap)
**Evidence:** prototypes are single-file monoliths; neither the audit nor the notes name components,
props, or ownership boundaries for any screen. Whatever framework renders them, Claude Code invents a
different decomposition per screen → inconsistent boundaries, duplicated state logic.
**Fix:** framework-neutral component inventory with contracts in `PHASE1_HANDOFF.md §C2`.

### 14. "Business Context preview" UI is specced in BUILD_PLAN but exists in no prototype
**Evidence:** BUILD_PLAN Phase 1: "UI: knowledge upload + **context preview**". No prototype surface
shows a distilled-context view. **Fix:** don't invent UI — P1 verifies BusinessContext via API/tests;
a designed surface is an open question for a later batch.

---

## P2 — hygiene (cheap now, corrosive if ignored)

### 15. Documentation has no canonical home and has already forked
- Repo copies of ARCHITECTURE/DATA_MODEL/etc. differ in size from this project's copies.
- **`PHASE1_ISSUES.md` was never committed to the repo** — only the TO_CREATE checklist is there, so
  Claude Code can't read the issue bodies it's meant to execute.
- **The repo's `CLAUDE.md` is empty (1 byte)** — Claude Code runs with zero standing instructions.
- Two full prototype sets + two CONSISTENCY_AUDIT copies exist in this project (root + handoff pkg);
  root `Onboarding.dc.html` already differs from the handoff copy (bundler thumbnail only — benign,
  but proves there's no sync rule).
**Fix:** repo = canonical; PR 0 in the handoff commits the missing docs + a real repo `CLAUDE.md`.

### 16. The superseded old-app restyle plan still reads as a live, LOCKED mandate
`design_handoff_clientforce_restyle/README.md` + `CONSISTENCY_AUDIT.md §4–§7` still instruct a
"full restyle, no partial phase" of the **Nuxt 2 app** with per-file maps. A fresh agent pointed at
the repo docs finds two conflicting execution plans. **Fix:** mark those sections historical
(the token/component/standards sections remain live; the extension section returns in Phase 4).

### 17. Internal errors in the architecture docs themselves
- `ARCHITECTURE.md §5`: `packages/ui — "Design tokens + shared **Vue** components"` — contradicts
  §2.6 and the merged React reality. (Stack question is settled on the merits: Phase 0 shipped
  Next.js/React and nothing argues for paying a rewrite tax — see handoff §A1.)
- `ARCHITECTURE.md §3a` "6-step builder" vs notes' "5-step" vs prototype (6, different labels).
- Campaign View tab count: 6 (§3a) vs 7 (notes) vs 8 (prototype).
- `BUILD_PLAN.md` Phase 0 has a duplicated `packages/db` bullet, and its "first tasks 1–4 = Phase 0"
  boundary contradicts `EXECUTION_PHASE0.md`'s T0–T8 (which includes the executor, design system,
  shell, infra, seed). Harmless now (Phase 0 is done) but confusing to any new reader.
**Fix:** exact patch list in `PHASE1_HANDOFF.md §D`.

### 18. No icon system for the greenfield app
Prototypes use placeholder glyphs (◈ ◎ ☺ ▤); the old-app rule ("use the repo's 273 SvgIcons")
doesn't apply to the new repo. **Fix (decided):** `lucide-react`, one mapping table, logged as it
grows.

### 19. Type-scale ambiguity makes fidelity checks unverifiable
CONSISTENCY_AUDIT §1.4 "recommends" collapsing 17 sizes to a 9-step ramp; UI_PORTING_RULES says lift
exact values from the prototype. Which wins during review? **Fix:** prototype literal values are the
Phase-1 acceptance standard; the ramp is deferred to a dedicated token pass.

### 20. No responsive spec below the prototype's desktop composition
Standards demand "responsive from 1280↓"; the prototypes are fixed desktop layouts with a 256px
sidebar and no designed breakpoint behavior. **Fix:** P1 rule = fluid 1280–1920, zero horizontal
scroll at 1280; <1280 explicitly unsupported this phase (tracked question for a design batch).

### 21. This project's root `CLAUDE.md` carries pre-Direction-E brand tokens
It names Sora/IBM Plex + `#F7F9F8` as the working system, while the locked product-UI system is
Bricolage/Hanken + the warm `#FBF7F0` palette (the audit explicitly removes Sora/IBM Plex). Fine for
*marketing/brand* collateral, but any future session here could inherit the wrong UI tokens.
**Fix:** add a one-line pointer distinguishing brand collateral vs product UI (Direction E wins in
product).

---

## What was checked and found sound
Worth saying so it isn't re-litigated: the tenancy hierarchy + RLS design, the event-bus-first
ordering, Temporal as the execution spine, the CampaignGraph node/edge contract, the three-tier
`SenderConnection` model (incl. reserved warmup/dedicated-IP fields), the P1.5 credential-handling
split (Key Vault vs field-encrypted per-tenant), suppression/opt-out acceptance criteria, and the
one-PR-per-unit + screenshot review gate all hold up. The Phase-0 ticket structure produced a clean
repo. The failures above are almost all **contracts left implicit between the design layer and the
build layer** — which is exactly what Phase 1 would have tripped on.

# PROGRESS — Phase 1

> Protocol: `PHASE1_HANDOFF.md §E`. Updated **in the same PR** as the work it
> describes. BLOCKING questions stop that thread; NON-BLOCKING proceed with the
> stated default and get logged here. Prototype-vs-spec conflicts are always a
> log entry, never a silent choice (atoms: token doc wins; composition/behavior:
> prototype wins — `UI_PORTING_RULES.md`).

## Status

| Unit | Status |
|---|---|
| PR 0 · repo/doc corrections (handoff §D) | 🔨 PR (this one) |
| C1 · shared UI components (`packages/ui`) | ⬜ |
| P1.1 · LLM gateway (`packages/ai`) | ⬜ |
| P1.2 · Knowledge ingestion + RAG (`packages/knowledge`) | ⬜ |
| P1.3 · Business Context distiller | ⬜ |
| P1.4 · Planner → CampaignGraph | ⬜ |
| P1.5 · Email adapter + `SenderConnection` (+A6/A7/A8 enforcement) | ⬜ |
| P1.6 · CampaignWorkflow (Temporal) | ⬜ |
| P1.7 · Inbound → classify → signal (+`Message` inbound, A9 names) | ⬜ |
| C2.1 · Shell landing (`/`→`/agents`), Dashboard stub, inert nav | ⬜ |
| C2.2 · Agents List (checkpoints §2) | ⬜ |
| C2.3 · Create Agent wizard (§3) | ⬜ |
| C2.4 · Agent view — 5 wired tabs (§4) | ⬜ |
| C2.5 · Contacts (§5) | ⬜ |
| C2.6 · Settings → Channels + Suppression (§6) | ⬜ |
| Clerk integration (A3 — own unit, due before any external demo) | ⬜ |

## Decision log

| ID | Date | Decision | Why | Reversibility |
|---|---|---|---|---|
| DEC-001 | 2026-07-02 | `apps/web` stays Next.js 15 + React 19; Vue only in the Phase-4 Chrome extension (tokens, not components) | Phase 0 shipped it; no Phase-1+ argument covers a rewrite tax (handoff A1) | expensive |
| DEC-002 | 2026-07-02 | Domain data = NestJS REST + zod DTOs in `packages/core`, one typed client, TanStack Query; Next API routes = auth/session only; no tRPC/GraphQL | Three docs disagreed; mixed protocols would ossify per screen (A2, re-audit #4) | moderate |
| DEC-003 | 2026-07-02 | Dev-JWT auth accepted for Phase 1; provider = Clerk as its own later unit, before any external demo | Unblocks the slice; onboarding UI waits for the provider (A3) | moderate |
| DEC-004 | 2026-07-02 | Realtime = TanStack Query polling (5s on Inbox/Logs/open lead drawer); no WebSockets this phase | Cheap, testable, nothing thrown away (A4) | cheap |
| DEC-005 | 2026-07-02 | 1 agent = 1 goal = 1 auto-created primary campaign ("Primary sequence") + graph v1 (AI); routes `/agents/[agentId]/[tab]`; sub-campaigns deferred | Owner-confirmed UI mapping; decides routes/queries/wizard writes (A5) | expensive |
| DEC-006 | 2026-07-02 | Add `Message` model; outbound persisted **as rendered** at send (P1.5), inbound + intent persisted (P1.7); Inbox/timeline read `Message`, events carry `messageId` refs only | Inbox needs a message store; events are a fan-out contract, not storage (A6, re-audit #1) | expensive |
| DEC-007 | 2026-07-02 | Add `Suppression` model; adapter checks Suppression **and** `Contact.optOut` before every send; unsubscribe writes both | Compliance-grade opt-out needs a provable ledger (A7, re-audit #2) | expensive |
| DEC-008 | 2026-07-02 | Guardrails = typed zod schema in `packages/core` (sending window w/ days+timezone, per-channel dailyCap, consent attestation, `unsubscribeFooter: true`, `suppressionCheck: true` — literal, not disableable) | Read by planner + adapter + workflow; a bare Json invites drift (A8, re-audit #6) | moderate |
| DEC-009 | 2026-07-02 | Event names: version suffix mandatory; canonical P1 set = `email.sent/delivered/opened/clicked/bounced/spam/replied.v1`, `lead.enrolled/stage_changed/unsubscribed.v1`; **`lead.replied` removed** (replies are channel-specific; consumers filter `*.replied.v1`) | Names ossify — Phase 6/7 subscribe to them (A9, re-audit #8) | expensive |
| DEC-010 | 2026-07-02 | Contacts segments are **queries**, not stages: All=everything · New=stage `new` · Replied=any `email.replied.v1` · Qualified=stage∈{`interested`} · Booked=stage `booked` · Unsub=`optOut.email` OR `Suppression` row OR enrollment `UNSUBSCRIBED`; keep the "Qualified" chip label | Prototype chips aren't pipeline stages (A10, re-audit #9) | cheap |
| DEC-011 | 2026-07-02 | Icons = `lucide-react`; prototype glyphs are placeholders; map once in §Icon map below and reuse verbatim | No icon system existed for the greenfield app (A11) | cheap |
| DEC-012 | 2026-07-02 | Fidelity standard = the prototype's literal values; CONSISTENCY_AUDIT "recommended ramps" deferred to a dedicated token pass — no silent normalization | Makes fidelity checks verifiable (A12, re-audit #19) | cheap |
| DEC-013 | 2026-07-02 | Sending domain `clientforce.io`, DNS at SiteGround **by the owner**; demo From = `agent@send.clientforce.io`; inbound parse MX on `reply.clientforce.io` only; Reply-To = the `reply.` address; **root-domain mail DNS (MX/SPF on `@`) is production — never add/edit/remove, never instruct to** | Root domain carries active company mailboxes (owner-confirmed, §G) | expensive |
| DEC-014 | 2026-07-02 | Test inbox + send allow-list for this phase = `tronwebng@gmail.com` | Owner-confirmed (§G) | cheap |
| DEC-015 | 2026-07-02 | Ingestion target = `https://clientforce.io`; **ingestion-proof rule:** planner copy must contain ≥2 concrete facts traceable to ingested pages, asserted against stored BusinessContext in P1.2/P1.4 tests | Proves the sequence came from ingestion, not model priors (§G) | cheap |
| DEC-016 | 2026-07-02 | Auth provider = Clerk (Google + Microsoft social desirable, non-essential); Phase 1 ships on dev-auth | Owner-confirmed (§G / Q-001) | moderate |
| DEC-017 | 2026-07-02 | PR 0 also fixes the wrong doc paths in `PHASE1_ISSUES.md` preamble (`docs/agent_platform_build/…` → repo root; prototypes path) — one line, beyond the literal §D list, flagged in the PR | Canonical-docs rule: a wrong path misdirects future sessions | cheap |
| DEC-018 | 2026-07-02 | `packages/events` still ships `lead.replied.v1` (catalog + sample publisher + tests). Removing it is **product code** → owed by **P1.7** (per handoff §B amendments), not PR 0. Docs updated now; code + catalog aligned in P1.7's PR | PR 0 is docs-only by definition (§D) | cheap |

## Open questions → design/product

| ID | Question | Type | Default taken (if non-blocking) | Status |
|---|---|---|---|---|
| Q-001 | Auth provider? | — | — | **ANSWERED** → Clerk (§G); Phase 1 stays dev-auth per A3 |
| Q-002 | Rename "Qualified" chip to "Interested"? | — | — | **ANSWERED** → keep "Qualified" (§G) |
| Q-003 | BusinessContext preview surface — no prototype exists | NON-BLOCKING | P1 verifies BusinessContext via API/tests only; no invented UI | OPEN (needs a design batch) |
| Q-004 | <1280px responsive treatment | NON-BLOCKING | Fluid 1280–1920, zero horizontal scroll at 1280; below 1280 unsupported this phase | OPEN (needs a design batch) |
| Q-005 | `OWNER_CHECKLIST.md` is referenced by handoff §G but absent from the repo | NON-BLOCKING | I author it during P1.5, when SendGrid emits the real DNS records — written click-by-click for a non-technical owner | OPEN |
| Q-006 | SendGrid domain-auth timing: §F says "start now, DNS lags"; owner's kickoff message says records at P1.5. Exact CNAMEs require SendGrid access (`SENDGRID-API-KEY`) | NON-BLOCKING | Wait for P1.5 per the owner's (later) message; if the key lands in Key Vault earlier, produce the SiteGround records the same day | OPEN (surfaced in kickoff reply) |
| Q-007 | Create GitHub issues for P1.1–P1.7, or work from `PHASE1_ISSUES.md` with plans as first PR comments? | NON-BLOCKING | Work from the doc; plans go on PRs (owner's kickoff instruction) — no issues unless requested | OPEN |

## Fidelity log

| Screen | State matrix captured | Deviations (DEC id) | Screenshots |
|---|---|---|---|
| _none yet — first UI PR is C1 (shared components on `/design`)_ | — | — | — |

## Icon map

Prototype glyph → `lucide-react` icon. **Append-only** — once mapped, reuse
verbatim everywhere.

| Glyph | Where seen | lucide icon |
|---|---|---|
| _none mapped yet — first entries land with C1/C2_ | | |

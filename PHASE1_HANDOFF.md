# Phase 1 Handoff — Clientforce Platform (email vertical slice, one milestone)

> **For Claude Code, working in `tronwebdev/clientforce-platform`.** This brief supersedes
> `P1.8_UI_WIRING_NOTES.md` (stale vs. prototypes) and amends `PHASE1_ISSUES.md` where noted.
> Still binding alongside it: `DATA_MODEL.md` (as amended in §A), `UI_PORTING_RULES.md` ("port from
> the prototype, don't reconstruct"), and **`PHASE1_FIDELITY_CHECKPOINTS.md` — the acceptance
> criteria for every screen.** Background on *why* each correction exists: `PHASE0_REAUDIT.md`.
>
> **Canonical-docs rule:** the repo is the single source of truth for docs and prototypes. If any
> other copy disagrees, the repo wins; fix forks by PR, never by editing two places.

---

## A. Architecture corrections (locked — apply before/with the first Phase-1 PRs)

**A1 · Stack (settled on the merits).** `apps/web` stays **Next.js 15 + React 19** — Phase 0 shipped
it, the tokens/components already exist in React, and nothing in Phase 1+ argues for paying a
rewrite tax. Vue remains only in the Chrome extension (Phase 4), which consumes tokens, not
components. Correct `ARCHITECTURE.md §5` ("shared Vue components" → "shared React components").

**A2 · API contract.** All domain data flows through the **NestJS API as REST with zod-typed DTOs**
(request + response schemas live in `packages/core`, imported by both API and web). `apps/web`
consumes it via one generated/typed client; **TanStack Query** for client-side reads/mutations
(add the dependency); Server Components may fetch through the same client for first paint. Next.js
API routes are for **auth/session cookie exchange only** — never domain data. No tRPC, no GraphQL
(remove the "tRPC/GraphQL" label from the ARCHITECTURE diagram).

**A3 · Auth posture.** Dev-JWT auth (Phase 0) is **explicitly accepted for Phase 1**, behind the
existing middleware. Managed provider **decided: Clerk** (Google + Microsoft social login
desirable, non-essential — §G). Clerk integration is its own unit, due before any external demo;
do not build the full Onboarding flow until it lands.

**A4 · Realtime.** Phase 1 = **TanStack Query polling** (5s `refetchInterval` on Inbox, Logs, and an
open lead drawer; default staleness elsewhere). No WebSockets this phase; don't build partial WS
plumbing.

**A5 · Agent ↔ Campaign ↔ Graph (UI mapping).** Owner-confirmed: an **agent = one goal**. Users
create several agents per workspace (one per goal, via the wizard); Agents List shows one row per
agent. v1 rule: **one agent : one auto-created primary campaign** (the goal's sequence).
Completing the wizard creates `Agent` + `Campaign` (name = "Primary sequence") + 
`CampaignGraph` v1 (`source: AI`; manual edits persist as new versions, `source: MANUAL`).
Routes: `/agents` (list) · `/agents/new` (wizard) · `/agents/[agentId]/[tab]` where tab ∈
`inbox|steps|leads|settings|logs` (+ inert `calls|preview|stats`), resolving the primary campaign
internally. Sub-campaigns/multi-campaign UI: deferred; the schema already supports it.

**A6 · New model: `Message`** (add to `DATA_MODEL.md §4`; migration in P1.5):
```prisma
model Message {
  id                String   @id @default(cuid())
  workspaceId       String
  campaignId        String
  enrollmentId      String?
  contactId         String
  channel           String              // "email" this phase
  direction         MessageDirection    // OUTBOUND | INBOUND
  subject           String?
  body              String              // rendered (outbound) / parsed (inbound)
  providerMessageId String?  @unique
  inReplyToId       String?             // → Message.id (threading)
  intent            String?             // inbound only, from P1.7 classification
  stepNodeId        String?             // outbound only, graph node that sent it
  sentAt            DateTime
  meta              Json?
  @@index([workspaceId, contactId, sentAt])
  @@index([workspaceId, campaignId, sentAt])
}
enum MessageDirection { OUTBOUND INBOUND }
```
P1.5 persists every outbound **as rendered** at send time; P1.7 persists every inbound + its intent.
Inbox threads and the lead-drawer timeline read `Message` (+ `Event` for non-message events). Events
stay the fan-out contract; they reference `messageId` in payloads rather than carrying bodies.

**A7 · New model: `Suppression`** (add to `DATA_MODEL.md §4`; enforcement in P1.5):
```prisma
model Suppression {
  id          String   @id @default(cuid())
  workspaceId String
  channel     String              // "email" this phase
  address     String              // email address (or phone later)
  reason      SuppressionReason   // UNSUBSCRIBED | BOUNCED | SPAM_COMPLAINT | MANUAL
  source      String?             // "reply" | "link" | "import" | "admin"
  createdAt   DateTime @default(now())
  @@unique([workspaceId, channel, address])
}
enum SuppressionReason { UNSUBSCRIBED BOUNCED SPAM_COMPLAINT MANUAL }
```
The email adapter checks Suppression **and** `Contact.optOut` before every send (both tested).
Unsubscribe events write both. Settings → Suppression (checkpoints §6) is its UI.

**A8 · Guardrails schema** (replaces the bare `Agent.guardrails Json` contract; zod in
`packages/core`, enforced by the adapter + workflow):
```ts
Guardrails = {
  sendingWindow: { days: number[],           // 1–7, ISO weekday
                   start: string, end: string, // "09:00"/"17:00"
                   timezone: string },
  dailyCap:      { email: number },           // per-channel, extended later
  consent:       { attestedBy: string, attestedAt: string } | null,
  unsubscribeFooter: true,                    // literal true — not disableable
  suppressionCheck:  true                     // literal true — not disableable
}
```
Wizard step 5 and the agent-view Settings tab read/write this shape.

**A9 · Event naming (amends `DATA_MODEL.md §5` + T2's example).** Version suffix **mandatory** in
`Event.type`. Canonical Phase-1 set:
`email.sent.v1 · email.delivered.v1 · email.opened.v1 · email.clicked.v1 · email.bounced.v1 ·
email.spam.v1 · email.replied.v1 (payload: messageId, intent) · lead.enrolled.v1 ·
lead.stage_changed.v1 · lead.unsubscribed.v1`.
**`lead.replied` is removed from the catalog** (a reply is always channel-specific; consumers filter
`*.replied.v1`). The Temporal branch signal carries the `email.replied.v1` payload.

**A10 · Contacts segments = queries, not stages** (checkpoints §5): All = everything · New = stage
`new` · Replied = has any `email.replied.v1` · Qualified = stage ∈ {`interested`} · Booked = stage
`booked` · Unsub = `optOut.email` OR any `Suppression` row OR enrollment `UNSUBSCRIBED`.
Owner-confirmed: keep the prototype's "Qualified" chip label.

**A11 · Icons.** `lucide-react`. Prototype glyphs (◈ ◎ ☺ ▤ …) are placeholders — map each to a
lucide icon once, record the mapping table in PROGRESS.md, and reuse it verbatim everywhere.

**A12 · Type/token precedence for reviews.** Fidelity = the prototype's literal values
(`UI_PORTING_RULES` rule). The CONSISTENCY_AUDIT "recommended ramps" (type, radius) are deferred to a
dedicated token pass — do not silently normalize values during porting.

---

## B. Phase 1 — one end-to-end milestone

**Goal (unchanged):** a real agent, built in the UI, reads a company's site, plans an email sequence,
sends it on a durable Temporal workflow, and — when the lead replies — classifies intent, branches,
and moves the pipeline, all visible in the app.

**Milestone acceptance = this demo script passes on staging, top to bottom:**
1. Log in → land on **/agents** → Agents List (empty state with CTA on a fresh workspace).
2. **New agent** → complete all 6 wizard steps: goal picked → URL ingested (status reaches READY) →
   planner drafts the sequence (≥1 delay, ≥1 reply-branch; tokens like `{{firstName}}` present) →
   edit one step (graph v2, MANUAL) → CSV/manual-add a real allow-listed test contact → guardrails
   set (window + daily cap) → launch (dark success state) → agent view.
3. Step 1 of the sequence **arrives in the real inbox** (SPF/DKIM-authed domain, unsubscribe footer).
4. Reply to it → within one poll: Inbox shows the thread under its classified intent chip; the
   workflow branches; the pipeline stage advances.
5. **Leads tab** → open the lead drawer: full timeline (enrolled → sent → delivered → opened →
   replied+intent → stage change). **Logs tab** shows the same campaign-wide.
6. Contacts: the lead appears under the correct segments; bulk-unsubscribe another test contact →
   Suppression row created → a send to them is provably blocked (test).
7. Kill and restart the worker mid-delay → the workflow resumes (durability check, from P1.6).

**Workstreams** (still one PR per unit, plan-comment first — but reviewed against the milestone, not
in isolation). P1.1–P1.7 execute per `PHASE1_ISSUES.md` **with these amendments**:
- **P1.5** additionally: `Message` persistence for outbound (A6), `Suppression` model + enforcement
  (A7), Guardrails schema enforcement (A8).
- **P1.7** additionally: `Message` persistence for inbound; event names per A9.
- **P1.8** is replaced by **§C below** (expanded UI scope, fidelity-gated).
Dependency order: P1.1 → P1.2/P1.3 → P1.4 → P1.5 → P1.6 → P1.7 → UI waves (§C) — UI shared
components (C1) can start in parallel with P1.1.

---

## C. The UI workstream (replaces P1.8)

**C1 — Shared components first** (in `packages/ui`, each demo'd on `/design`): AppDrawer (460/480/
500px variants), Modal, DataTable (header/rows/checkbox/selection/bulk-bar/pagination anatomy),
SegmentTabs, BulkBar, ChannelChip, Stepper, Skeleton, EmptyState (+ reuse existing Button/Card/
Dropdown/Pill/Tabs/Toast/Toggle). Specs = checkpoints §0 global conventions; these kill the
copy-paste-drawer drift class of bug before it starts.

**C2 — Screens, in this order** (each gated on `PHASE1_FIDELITY_CHECKPOINTS.md`):
1. Shell landing: `/` → redirect `/agents`; Dashboard stub (designed empty state); inert nav targets.
2. **Agents List** (checkpoints §2) — list, filters, columns, create CTA, row nav.
3. **Create Agent wizard** (§3) — 6 steps, wired to P1.2 ingest, P1.4 planner, A5 create path.
4. **Agent view** (§4) — Steps, Leads (+ lead drawer), Inbox, Logs, Settings tabs; Calls/Preview/
   Stats inert.
5. **Contacts** (§5) — segments per A10, drawer, bulk actions.
6. **Settings → Channels + Suppression** (§6).
Component boundaries within screens: one component per prototype anchor group (the prototype's
`renderVals` keys mark the seams — e.g. `leadDrawerOpen`, `csv.*`, `senderDrawer` each = one
component). Name components after the anchor, log the inventory in PROGRESS.md as you go.

**Out of scope, present-but-inert (do not delete, do not fake):** Calls/voice, SMS/WhatsApp/LinkedIn
channels, Lead Finder, Proposals, Forms, Agent Widget, deep Stats, wizard step-4 capture backend,
sender warmup logic, dedicated-IP upgrade flow, full Onboarding flow, Dashboard content, WebSockets.

---

## D. PR 0 — repo/doc corrections (first PR of the phase, no product code)

1. Commit `PHASE1_ISSUES.md`, this file, `PHASE1_FIDELITY_CHECKPOINTS.md`, `PHASE0_REAUDIT.md`.
2. Write a real repo **`CLAUDE.md`** (it is currently empty): stack + A1–A12 summary, canonical-docs
   rule, UI_PORTING_RULES pointer, PROGRESS.md protocol (§E), "one PR per unit, plan-comment first".
3. Patch `ARCHITECTURE.md`: §5 Vue→React; §3 diagram "tRPC/GraphQL"→"REST (zod DTOs)"; §3a "6-step
   builder" keep but fix labels; tab list → 8 tabs.
4. Patch `DATA_MODEL.md`: add A6/A7 models, A8 schema, A9 event catalog fix (incl. T2's
   `lead.replied.v1` example → `email.replied.v1`).
5. Mark `P1.8_UI_WIRING_NOTES.md` superseded (banner at top pointing here); mark the old-app restyle
   sections of `design_handoff_clientforce_restyle/{README,CONSISTENCY_AUDIT}.md` **historical**
   (tokens/components/standards sections remain live; extension section returns in Phase 4).
6. Fix `BUILD_PLAN.md` Phase-0 duplicate bullet + align its Phase-0/1 boundary note with
   `EXECUTION_PHASE0.md` (T0–T8).

---

## E. PROGRESS.md — the working agreement (maintain at repo root)

Update **in the same PR** as the work it describes. Sections, in order:

```markdown
# PROGRESS — Phase 1
## Status
One line per workstream: ⬜ / 🔨 PR#n / ✅ merged.
## Decision log
DEC-### · date · decision · why · reversibility (cheap/moderate/expensive)
(Seed with A1–A12 as DEC-001…012 and §G as DEC-013+, source: this handoff.)
## Open questions → design/product
Q-### · question · BLOCKING or NON-BLOCKING · default taken (if non-blocking) · status
(Seed: Q-001 auth provider — ANSWERED → Clerk, see §G; Phase 1 stays dev-auth per A3 · Q-002
"Qualified" label — ANSWERED → keep · Q-003 BusinessContext preview surface [no prototype exists —
needs a design batch] · Q-004 <1280px responsive treatment [needs a design batch].)
## Fidelity log
screen · state matrix captured (y/n) · deviations (each with a DEC id) · screenshot links
## Icon map
prototype glyph → lucide icon (append-only)
```

**Rules:** BLOCKING questions stop that thread — ask, don't guess; NON-BLOCKING → proceed with the
stated default and log it. Any prototype-vs-spec conflict = a log entry, never a silent choice
(atoms: token doc wins; composition/behavior: prototype wins — `UI_PORTING_RULES.md`). Every UI PR
carries the checkpoint §8 screenshot set. Never mark a checkpoint passed without having rendered
both prototype and build and compared them.

---

## F. Keys & environment (unchanged from `PHASE1_ISSUES_TO_CREATE.md`)

Into Key Vault as needed: `ANTHROPIC-API-KEY` (before P1.1) · `OPENAI-API-KEY` (embeddings, P1.2, 1536-dim) ·
`SENDGRID-API-KEY` sandbox (P1.5) · SendGrid **domain auth DNS for `clientforce.io` — start now,
it lags** (owner runs it at SiteGround — §G) · inbound-parse webhook (P1.7) · allow-listed test
address = `tronwebng@gmail.com` (final demo). Temporal secrets already present.

---

## G. Demo & environment configuration (owner-confirmed, 2026-07-02)

- **Sending domain:** `clientforce.io`, DNS managed at **SiteGround** (the owner adds the records;
  click-by-click lives in `OWNER_CHECKLIST.md`). Authenticate the domain in SendGrid; send demo
  email from a **subdomain From-address** (default `agent@send.clientforce.io`) to protect
  root-domain reputation. Inbound parse uses a subdomain MX only (default `reply.clientforce.io`) —
  **never add or change MX on the root domain.**
- **⚠ Root domain carries ACTIVE company mailboxes (owner-confirmed).** Treat root-level mail DNS
  (MX, SPF/TXT on `@`) as production infrastructure: never add, edit, or remove those records, and
  never instruct the owner to. Everything the product needs lives on the two subdomains above
  (domain-auth CNAMEs don't touch mail routing; the only MX we ever add is on `reply.`). Set
  Reply-To on outbound to the `reply.` address so human replies route to inbound parse.
- **Test inbox:** `tronwebng@gmail.com` — receives the demo sequence, sends the reply, and is the
  send allow-list for this phase.
- **Ingestion target:** `https://clientforce.io`. **Ingestion-proof rule:** the planner's drafted
  copy must contain ≥2 concrete facts traceable to the ingested pages (assert against the stored
  BusinessContext in P1.2/P1.4 tests) — proof the sequence came from ingestion, not the model's
  prior knowledge of the company. Optional control: a second agent ingesting an unrelated
  small-business site.
- **Auth (Q-001):** Clerk; Google + Microsoft social login desirable, non-essential. Phase 1 ships
  on dev-auth (A3).
- **Q-002:** keep the "Qualified" label.

# Clientforce Agent Platform — Greenfield Architecture

> The system design for a from-scratch build of the Clientforce AI agent platform.
> Derived directly from the prototype behavior (the prototypes are the product spec).
> Companion docs: `BUILD_PLAN.md` (phased execution) and `README.md` (how to run with Claude Code).

---

## 1. What the platform must do (from the prototype)
An **agent** is a goal-driven worker, not a drip campaign. Reading the prototype end to end:

1. **Takes a goal** (e.g. "book new-patient appointments for this clinic").
2. **Ingests company knowledge** (docs, site, uploads) and forms a durable **business context**.
3. **Plans a campaign**: a multi-channel **sequence with delays, branches, and pipeline movement**
   — not a fixed list. ("Email → wait 2d → if no reply, SMS → if positive reply, voice call.")
4. **Executes across channels**: Email, SMS, WhatsApp, **real AI voice calls**, LinkedIn (via the
   extension), with calendar/booking. Respects sending windows, daily limits, sender health/warmup.
5. **Listens for replies and events** (opens, inbound messages, call outcomes) and **triggers actions**:
   classify intent → branch the sequence → move the lead through the **pipeline** → notify.
6. **Closes live on voice calls** through Twilio — and can **send proposals / booking links during the
   call** by calling integrations as tools.
7. **Embeds on a website as a chat** that uses the same goal + knowledge to engage, capture, convert.

Everything below exists to serve those seven capabilities.

---

## 2. Technology decisions (and why)

### 2.1 Language: **TypeScript, end to end** ✅
You asked for the best language for *this* product. It's TypeScript, decisively:
- **One language across the whole surface** — API, workflow workers, voice bridge, embeddable widget,
  the Next.js web app, and the existing Vue 3 Chrome extension. One mental model, shared types for the
  campaign graph / lead / pipeline.
- **Best-in-class agent + AI SDKs** (Anthropic SDK, Vercel AI SDK, Temporal TS SDK, Twilio).
- **Claude Code is strongest in TS** — directly relevant to your days-to-weeks timeline.
- Laravel/PHP is fine for CRUD, but weak for long-running, reply-driven, real-time agent orchestration.
- *(A small Python service is optional later if you adopt a Python-only ML lib — not needed to start.)*

### 2.2 The execution engine: **Temporal** ✅ (the single most important choice)
The campaign engine has to **wait days, survive restarts, and branch on events that arrive later**.
Cron jobs and queues make this fragile. **Temporal** is purpose-built for it:
- **Durable timers** — "wait 2 days" is a first-class primitive, not a scheduled-job hack.
- **Signals** — an inbound reply/call-outcome is a signal that wakes the exact lead's workflow and
  branches it. This *is* the prototype's reply-driven branching.
- **Crash-proof** — a workflow resumes precisely where it left off; no lost or double-sent steps.
- **Visibility** — every lead's journey is inspectable, which powers the prototype's per-lead timeline.
- Run **Temporal Cloud** (managed, cloud-agnostic) to start; self-host on Azure later if desired.

### 2.3 Backend framework: **NestJS** (modular monolith)
Structured, DI-based, team- and Claude-Code-friendly; scales to split into services later without a
rewrite. Start as **one deployable modular monolith** + separate Temporal workers — do **not** start
with microservices.

### 2.4 AI stack (recommendation)
- **Reasoning brain — Anthropic Claude.** Planning, message generation, reply classification, the
  voice-call brain, and the chat widget. Best agentic tool-use + copywriting, which is the whole job.
- **LLM gateway abstraction** (thin internal module over the Vercel AI SDK) so a model is swappable
  per task and you're never locked in.
- **Voice = realtime pipeline**, bridged through Twilio Media Streams:
  **Deepgram** (speech-to-text) → **Claude** (brain + tools) → **Cartesia or ElevenLabs** (text-to-speech).
- **Agent tools are a unified framework** (used by voice *and* the chat widget): a `send_proposal` tool
  backed by the **native Proposals subsystem** (§3a — pick a template, fill dynamic variables, send a
  tracked hosted link), plus **integration-backed actions** surfaced as tools (e.g. `book_meeting` via
  Calendly/Cal.com, CRM updates) registered dynamically from the Integrations platform. New external
  actions are added via Integrations + Automations rules — no agent-code change.
- **Embeddings:** OpenAI `text-embedding-3-large` or Voyage — stored in **pgvector** (no separate
  vector DB needed at this scale).

### 2.5 Data & infra
- **PostgreSQL + `pgvector`** — primary store *and* knowledge embeddings in one DB. **Prisma** ORM.
- **Redis** — cache + lightweight fan-out jobs (webhook processing) via **BullMQ** (Temporal owns the
  long-running orchestration; Redis owns fast, fire-and-forget work).
- **Email — SendGrid** (LOCKED): the full sending system on SendGrid with **subusers per workspace/
  agency** and **dedicated IPs** with proper **IP warmup**, plus SPF/DKIM/DMARC per sending domain.
  Inbound + event webhooks (delivered/open/click/bounce/spam/reply) feed the event bus. Subusers map
  cleanly onto the white-label tenancy (§3b) and isolate each tenant's sender reputation.
- **WebSockets** (NestJS gateway, or **Azure Web PubSub**) — chat widget + voice signaling + live UI.
- **Object storage** — Azure Blob (uploads, call recordings, proposal assets).

### 2.6 Frontend: **Next.js (React) + TypeScript** — chosen for scale
You asked for the strongest forward-looking, scale choice with no preference — that's **Next.js/React**:
the largest ecosystem and talent pool, App Router + Server Components for performance at scale, and
first-class alignment with the **Vercel AI SDK** (our LLM gateway). State via TanStack Query + Zustand.
- **Tradeoff, handled:** the restyle design system was specced framework-agnostically — **tokens carry
  over unchanged**; shared components get built once in React in `packages/ui`. The **Chrome extension
  stays Vue 3** (separate surface, separate repo) and consumes the same tokens. Mixing is fine because
  they don't share component code, only the design system.

### 2.7 Hosting: Azure for the platform; **voice placed by latency, not by cloud**
- **Azure Container Apps** — API, workers (scales to zero, simple).
- **Azure Database for PostgreSQL Flexible Server** (enable `pgvector`).
- **Azure Cache for Redis**, **Azure Blob Storage**, **Azure Container Registry**.
- **Vercel or Azure Static Web Apps / Front Door** — Next.js app + widget/hosted-pages CDN.
- **Temporal isn't a native Azure service** → use **Temporal Cloud** (cloud-agnostic).
- **On voice — Azure is NOT required, and shouldn't be the deciding factor.** The voice loop
  (Twilio Media Streams ↔ Deepgram ↔ Claude ↔ TTS) is latency-sensitive; what matters is **physical
  proximity between the voice-bridge service, Twilio's media region, and the model/STT/TTS providers** —
  target <800ms round-trip. So host the **voice bridge wherever that path is shortest** (often a region
  close to your Twilio numbers and the AI providers), which *may or may not* be the same Azure region as
  the rest. Run it on Azure Container Apps **if** an Azure region satisfies the latency budget; otherwise
  place just the voice service elsewhere (it talks to the platform over the API/event bus, so it doesn't
  need to be co-located with Postgres). Everything non-voice stays on Azure. Net: **keep Azure for the
  platform; choose the voice region by measured latency, independently.**

---

## 3. System architecture

```
                          ┌─────────────────────────────────────────────┐
                          │  Next.js Web App  ·  Chrome Ext (Vue3)        │
                          │  Embeddable Chat Widget (JS snippet)          │
                          └───────────────┬───────────────────────────────┘
                                          │ REST (zod DTOs) + WebSocket
                          ┌───────────────▼───────────────┐
                          │      NestJS API (monolith)     │
                          │  auth · tenancy · campaigns ·  │
                          │  leads · pipeline · realtime   │
                          └───┬───────────┬───────────┬────┘
              plans/copy      │           │           │   enqueue
            ┌─────────────────▼──┐   ┌────▼─────┐  ┌──▼────────────────┐
            │  AI Gateway (Claude)│   │ Postgres │  │  Temporal          │
            │  planner·writer·    │   │ +pgvector│  │  CampaignWorkflow  │
            │  classifier·voice   │   │  Prisma  │  │  per lead:         │
            └─────────┬───────────┘   └──────────┘  │  timers·branches·  │
                      │ RAG                          │  signals·pipeline  │
            ┌─────────▼───────────┐                  └───┬────────────────┘
            │ Knowledge: ingest → │                      │ activities
            │ chunk → embed → ctx │          ┌───────────▼───────────────┐
            └─────────────────────┘          │   Channel Adapters         │
                                             │  email·sms·whatsapp·voice· │
   inbound events  ┌────────────────┐        │  linkedin·calendar         │
   (webhooks) ────▶│ Event Ingest → │───sig─▶│  (pluggable interface)     │
   opens/replies/  │ normalize →    │        └───────────┬───────────────┘
   call outcomes   │ classify(Claude)│                   │
                   └────────────────┘        ┌───────────▼───────────────┐
                                             │ Twilio · ESP · Deepgram ·  │
                                             │ TTS · Cal/booking · CRM    │
                                             └────────────────────────────┘
```

## 3a. Full feature surface — this is a platform, not one agent

A thorough read of **every** prototype shows the agent is the spine, but the product is a full
go-to-market platform. Each of these is its own backend module/subsystem (NestJS module +
Prisma models + UI), all sharing the tenancy, AI gateway, and event bus:

| Subsystem | What it is | Heaviest backend pieces |
|---|---|---|
| **Agents / Campaigns** | the 6-step builder (Set the goal · Design sequence · Add contacts · Enable lead capture · Guardrails & compliance · Preview & launch), Campaign View — 8 tabs (inbox/calls/steps/leads/preview/stats/settings/logs), sub-campaigns, per-agent automation rules | Temporal workflows, channel adapters, planner |
| **Automations engine** | standalone **When → Only-if → Then** rules across the whole app: triggers (replies, calls, forms, payments, LinkedIn, schedule), conditions, multi-action, recipes, **run history** | event bus, rule evaluator, action executors, audit log |
| **Integrations platform** | OAuth catalog (HubSpot, Salesforce, Pipedrive, GCal, Calendly, Cal.com, Gmail, Outlook, SMTP, Twilio, WhatsApp, Slack, Stripe) + **Zapier** + outbound **Webhooks** (POST every event) | OAuth broker, per-provider sync adapters, token vault, webhook dispatcher w/ retries & signing |
| **Lead Finder / Auto-Prospecting** | DB + Apollo search **and** signal-based intent discovery — job-change/hiring/funding signals, scraped Reddit/LinkedIn/Twitter/forum posts, enrichment, **intent scoring**, daily refresh, auto-match to campaigns | scraping/ingest workers, enrichment providers, scoring model, scheduled refresh jobs |
| **Contacts / CRM** | lists, segments, filters, sortable table, bulk actions, contact timeline, **CSV import** (upload→map→review), tags | import pipeline, dedupe/merge, activity timeline events |
| **Forms** | builder (field types, options, reorder, templates), design (colors/dark/double-opt-in/redirect), **hosted public forms**, submissions → routing to campaign/list | hosted form renderer, submission ingest → event bus, double-opt-in |
| **Proposals** | "Dynamic Proposals" auto-filled per lead, builder (cover/details/CTA/pricing), send (email/SMS/WhatsApp + **tracked link**), **hosted proposal page** with Pay (Stripe) / Book / Accept, view tracking | hosted renderer, tracking pixels/events, Stripe checkout, e-accept record |
| **Widget** | design + capture fields (CRM-mapped) + behaviour (booking & proposal questions) + routing + **embed snippet** | hosted widget bundle, WebSocket chat, same agent brain + tools |
| **Analytics** | overview / engagement / deliverability / conversions / channels / agents / revenue — KPIs, funnel, donuts, per-agent leaderboard, **export** | event warehouse, rollup/aggregation jobs, query API |
| **Billing & credits** | plans, **per-channel credit consumption** (voice costs more), invoices, Stripe | metering, Stripe subscriptions + usage, credit ledger |
| **Account Admin — white-label** | **agency / agency** model: workspaces, **client sub-accounts**, agency earnings, agency payouts, plan management | the tenancy hierarchy itself (below) + payouts |

## 3b. Tenancy is a 3-level white-label hierarchy (not flat)

The Account Admin prototype is decisive: Clientforce is sold **as a white-label platform to agencies**,
who resell **sub-accounts** to their clients. The data model and auth must encode this from day one —
retrofitting it later is extremely painful.

```
Agency  (white-label brand, plan, earnings, payouts)
   └─ Workspace / Sub-account  (a client; own data, members, usage, billing)
        └─ User  (role: owner / admin / agent)  +  RBAC
```
Every domain row carries `workspace_id`; workspaces roll up to a `agency_id`. Postgres **RLS** scopes
queries to a workspace; agency-level views aggregate across owned workspaces. Branding (logo, domain,
colors), plan limits, and credit balances live at both agency and workspace levels. **This shapes
auth, the API, billing, and analytics** — it is a Phase-0 decision, not a later feature.

## 3c. Eventing is the backbone

Almost every subsystem is wired through one **internal event bus** (e.g. `email.replied.v1`,
`call.completed.v1`, `form.submitted.v1`, `payment.received.v1`, `proposal.viewed.v1`,
`linkedin.captured.v1` — version suffix mandatory, see `DATA_MODEL.md §5`).
Three consumers fan out from it: **(1)** Temporal signals (branch a campaign), **(2)** the Automations
engine (evaluate When/If/Then rules), **(3)** the outbound integrations/webhooks/Zapier dispatcher and
the analytics warehouse. Build this bus early — it's what makes the whole app feel alive and connected.

### 3.1 The agent loop (core domain)
1. **Knowledge → Context.** Ingestion pipeline crawls site / parses uploads → chunks → embeds
   (pgvector) → Claude distills a structured **Business Context** (offer, ICP, proof, tone, constraints).
2. **Goal → Plan.** The **Planner** (Claude, tool-constrained) takes `goal + business context +
   available channels/integrations + guardrails` and emits a **typed Campaign Graph**: nodes (channel
   steps), edges (delays + branch conditions), and pipeline-stage transitions. Stored, versioned,
   human-editable in the UI (this is the prototype's Steps tab + per-channel editor).
3. **Enroll → Execute.** Each lead enrolled starts a **Temporal `CampaignWorkflow`** that walks the
   graph: run step (activity → channel adapter) → durable wait → await reply **signal** → branch →
   update pipeline → repeat. Sending windows, daily caps, and sender health are enforced here.
4. **React.** Inbound webhooks (open/click/reply, inbound SMS/WhatsApp, call summary) → normalized →
   **intent classified by Claude** → emitted as a **signal** to that lead's workflow → branch / move
   pipeline / notify / hand to voice.
5. **Close (voice).** A "voice call" node (or a hot lead) launches the **voice agent**: Twilio dials,
   media streams bridge to Deepgram→Claude→TTS, and Claude calls live tools to **send a booking link
   or proposal mid-call** and **book the meeting**.
6. **Convert (widget).** The embeddable chat runs the *same* brain + knowledge with capture/convert
   tools, can enroll a visitor into a campaign or book them directly.

### 3.2 Channel adapter interface (pluggable)
Every channel implements one interface so the engine is channel-agnostic and new channels are additive:
```ts
interface ChannelAdapter {
  channel: 'email' | 'sms' | 'whatsapp' | 'voice' | 'linkedin';
  send(ctx: StepContext, lead: Lead, content: RenderedStep): Promise<SendResult>;
  // inbound events arrive via webhooks → EventIngest → workflow signals
  validate(content: DraftStep): ValidationReport; // deliverability, char/segment, template approval
}
```
Adapters at launch: **Email** (**SendGrid** — subusers + dedicated IPs + warmup), **SMS +
WhatsApp** (Twilio), **Voice** (Twilio Media Streams), **LinkedIn** (the Chrome extension is the
actuator via your API), **Calendar** (Cal.com/Calendly/Google).

---

## 4. Cross-cutting: multi-tenancy, security, compliance
- **Multi-tenant** from day one: every row carries `org_id`; enforce with Postgres **row-level
  security** + tenant-scoped Prisma client. (Pre-launch greenfield = clean, no migration.)
- **Auth:** modern provider (Azure AD B2C, Auth0, or Clerk) — don't hand-roll. RBAC (owner/admin/agent).
- **Secrets:** Azure Key Vault. Per-tenant channel credentials encrypted at rest.
- **Compliance (must-have for outbound):** SMS **TCPA** consent + **STOP** opt-out (the prototype
  already appends it — make it enforced, not cosmetic); email **SPF/DKIM/DMARC** + unsubscribe; **GDPR**
  data export/delete; WhatsApp uses **approved templates** only; call **recording consent** per region.
- **Guardrails on the AI:** the planner/writer operate inside policy (no banned claims, respect
  sending windows/caps, escalate-to-human on negative sentiment). Log every AI decision for audit.
- **Observability:** OpenTelemetry traces, structured logs, Sentry; Temporal gives per-lead replay.

---

## 5. Monorepo layout (Turborepo)
```
apps/
  web/         Next.js app (operator console — every subsystem's UI)
  api/         NestJS — REST (zod DTOs) + webhooks + WebSocket gateway
  worker/      Temporal workers (CampaignWorkflow + activities)
  voice/       Twilio media-stream bridge (Deepgram→Claude→TTS)
  widget/      Embeddable chat widget (standalone bundle)
  hosted/      Public-facing pages: forms, proposals (tracked, branded)
packages/
  core/        Domain types: CampaignGraph, Lead, Pipeline, Event, StepContext
  ai/          LLM gateway, prompts, planner, classifiers, voice brain
  events/      Internal event bus + typed event catalog (§3c)
  channels/    Adapter interface + email/sms/whatsapp/voice/linkedin
  knowledge/   Ingestion + RAG (pgvector)
  automations/ When→If→Then rule engine + action executors
  integrations/ OAuth broker, provider adapters, Zapier, webhook dispatcher
  prospecting/ Lead Finder: search + signal scraping + enrichment + scoring
  forms/       Form builder model + hosted renderer + submission ingest
  proposals/   Proposal model + hosted renderer + tracking + Stripe
  contacts/    Lists, segments, CSV import, dedupe, timeline
  billing/     Plans, credit ledger/metering, Stripe, agency payouts
  analytics/   Event warehouse, rollups, query API
  tenancy/     Agency→Workspace→User hierarchy, RBAC, RLS, branding
  db/          Prisma schema + migrations + tenant-scoped client
  ui/          Design tokens + shared React components
  config/      env, logging, auth, telemetry
infra/         Bicep/Terraform for Azure + Temporal Cloud wiring
```
*(The existing `clientforce-chrome` extension stays its own repo, consuming `packages/ui` tokens + the API.)*

---

## 6. The goal: a genuinely production-grade platform
The objective is **not** a demo — it's a real, working, world-class app. An investor seeing it should
recognize full value because it *is* full value: every screen wired to real data, real sends, real
money, real multi-tenancy. Quality bar is the standard in `CONSISTENCY_AUDIT.md §6a` (WCAG AA, loading/
empty/error states, observability, security review, no dead UI) applied across the whole surface.

Honest timeline, given the head start (**APIs, approvals, Twilio, and a complete UI spec already exist**):
- **Days:** the foundation + a working vertical slice — tenancy → knowledge → plan → email sequence
  with a real reply branching the journey and moving the pipeline.
- **Weeks:** the remaining channels (SMS/WhatsApp/voice), then the subsystems — Automations,
  Integrations/Zapier, Lead Finder, Contacts, Forms, Proposals, Widget, Analytics.
- **Long poles (plan for these explicitly):** the **voice agent** (latency/cost), **compliance**
  (consent, warmup, opt-out, per-region), **billing/credits + agency payouts** (money is
  unforgiving), and the **white-label tenancy** (must be right from Phase 0). "Full production in days"
  is realistic for the slice; the *complete* platform at this quality is a focused multi-week effort —
  and the build plan sequences it so something real ships and is testable at every step.

Build plan and the Claude-Code task breakdown are in **`BUILD_PLAN.md`**.

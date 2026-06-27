# Clientforce Agent Platform — Build Package

Greenfield architecture + execution plan to build the full Clientforce AI agent platform from
scratch, install it in a new setup, and test before going wide.

## Contents
- **`ARCHITECTURE.md`** — the system design: what the agent must do, the technology decisions (and
  why), the full architecture, the agent loop, channel adapters, multi-tenancy/security/compliance,
  the monorepo layout, and honest timeline expectations. **Read this first.**
- **`BUILD_PLAN.md`** — phased, demo-driven build plan (Phase 0 → 11, covering the **full platform**:
  agent core, then Automations, Integrations/Zapier, Lead Finder, Contacts, Forms, Proposals, Widget,
  Analytics, Billing/credits & white-label agency) with the exact first tasks to hand Claude Code.
- **`DATA_MODEL.md`** — the keystone contracts: full Prisma schema (3-level tenancy, agents, leads,
  pipeline), the **CampaignGraph JSON schema**, the **event catalog**, billing/credits, forms/proposals/
  widget. Everything else builds against this — generate the schema from it first.
- **`Platform-Architecture.html`** — the full-system diagram (self-contained; open offline, print to PDF).
- **`EXECUTION_PHASE0.md`** — the Phase-0 Claude Code ticket pack (T0–T8, one PR each) + the
  provisioning/secrets checklist. Start building from here.
- **`PHASE0_ISSUES.md`** — the same T0–T8 as **ready-to-paste GitHub issues** (title + body +
  acceptance criteria each) for Claude Code.
- **`PRODUCT_DECISIONS.md`** — the handful of product choices that refine the build (credit pricing,
  plan limits, v1 integrations, **Lead Finder signal sources**, pipeline stages, AI models, compliance),
  each with a recommendation + a slot for your answer.
- Pair with **`../design_handoff_clientforce_restyle/`** — the design system, tokens, and the
  prototype `.dc.html` files are the **product + visual spec** the build implements.

## This is the whole app, not just the agent
The agent is the spine, but the platform also includes: a standalone **Automations** (When→If→Then)
engine, an **Integrations** platform (CRM/calendar/inbox/messaging/payments + **Zapier** + webhooks),
**Lead Finder / Auto-Prospecting** (signal-based intent discovery + enrichment), **Contacts/CRM**,
**Forms**, **Proposals** (hosted, tracked, Stripe-payable), the embeddable **Widget**, **Analytics**,
**Billing/credits**, and a **white-label agency** model (Agency → sub-accounts → workspaces).
The goal is a **production-grade app** — real value an investor recognizes because it genuinely works.

## The short version of the decisions
- **Language:** TypeScript end-to-end (one stack across app, API, workers, voice, widget, extension).
- **Execution engine:** **Temporal** — durable timers ("wait 2 days") + signals (reply-driven
  branching). This is the keystone choice.
- **Backend:** NestJS modular monolith + Temporal workers (not microservices yet).
- **AI:** Claude as the brain (planning, copy, classification, voice); model-agnostic gateway; voice =
  Twilio Media Streams → Deepgram → Claude → TTS, with live tools (booking/proposal).
- **Data:** Postgres + pgvector (one DB for data *and* knowledge embeddings) + Redis.
- **Frontend:** **Next.js (React) + TypeScript** — chosen for ecosystem, talent pool, and scale;
  tokens from the restyle package carry over, components built once in React. Chrome extension stays Vue 3.
- **Email:** **SendGrid** — subusers per tenant + dedicated IPs + warmup, mapped onto the white-label tenancy.
- **Hosting:** Azure (Container Apps + Postgres Flexible Server + Redis + Blob) + Temporal Cloud;
  colocate voice for latency.

## How to run it with Claude Code
1. Create a **fresh repo** for the platform (greenfield — migrate nothing).
2. Connect Claude Code; point it at this folder as the spec.
3. Execute **Phase 0 → Phase 1** first (foundation + the email vertical slice) — that's your first
   demo-able test in the new setup.
4. One task = one PR (the ordered task list is at the end of `BUILD_PLAN.md`). Review, merge behind a
   flag, demo at each phase boundary.

## Decisions — all locked
- **Web app: Next.js (React).** Best forward-looking/scale choice; tokens reused, components rebuilt in React; extension stays Vue 3.
- **Email: SendGrid** with subusers + dedicated IPs + warmup.
- **Proposals: native subsystem** — templates + dynamic variables, agent picks/embeds/sends, hosted & tracked. **Booking + other external actions via Integrations + Automations** (Calendly, etc.), surfaced to the agent as tools.
- **Voice region: chosen by measured latency, independently of Azure** — platform stays on Azure; the voice bridge is placed wherever the Twilio↔STT↔Claude↔TTS path is shortest. Azure is not required for voice.

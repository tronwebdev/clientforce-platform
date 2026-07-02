# Clientforce Agent Platform — Build Plan (Claude Code execution)

> Phased, demo-driven plan. Each phase ends in something you can **show and test in a new setup**.
> Read `ARCHITECTURE.md` first. Build greenfield in a fresh repo; migrate nothing (pre-launch).

---

## How to work
- **One vertical slice before breadth.** Get a single channel (email) working end-to-end through the
  real agent loop before adding SMS/WhatsApp/voice. Resist building all adapters first.
- **Demo at the end of every phase.** Each phase has an acceptance demo you can run in the test setup.
- **Claude Code: one task = one PR**, reviewed and merged behind a flag. Tasks below are sized for that.
- **Tests as you go** — domain logic (campaign graph, branching) and adapters get unit tests; the
  agent loop gets one integration test per phase.

---

## Phase 0 — Foundation (Day 1–2)
**Goal:** the skeleton runs locally and deploys to a fresh Azure setup.
- [ ] Turborepo monorepo (§5 of ARCHITECTURE) with `apps/*` + `packages/*` scaffolds.
- [ ] `packages/tenancy` + `packages/db`: Prisma + Postgres + `pgvector`; the **3-level hierarchy** —
      `Agency → Workspace → User` (RBAC) — plus `Agent`, `Campaign`, `CampaignGraph`, `Lead`,
      `Enrollment`, `Event`, `PipelineStage`. Every domain row carries `workspace_id`; **RLS** enforced.
- [ ] `packages/events`: the internal **event bus** + typed event catalog (§3c) — built now because
      everything hangs off it.
- [ ] `apps/api`: NestJS boots, health check, auth provider wired (Azure AD B2C / Clerk), tenant
      middleware + RLS, agency/workspace context resolution + branding.
- [ ] `packages/ui`: design tokens from `CONSISTENCY_AUDIT.md` (Bricolage + Hanken, `#35E834`, scales).
- [ ] `apps/web`: Next.js boots, logs in, renders the shell + sidebar in the design system.
- [ ] `infra/`: Bicep/Terraform for Container Apps, Postgres Flexible Server, Redis, Blob, ACR; Temporal Cloud namespace.
- [ ] CI/CD: build, test, deploy-to-Azure pipeline.
- **Demo:** log into the deployed shell; DB migrations applied in the cloud.

> ⚠️ **Phase 0 is bigger than "scaffold."** The white-label tenancy hierarchy and the event bus are
> foundational — getting them right now is far cheaper than retrofitting. Don't rush past them.

## Phase 1 — Vertical slice: the Email agent (Day 3–6) ⭐
**Goal:** prove the whole agent loop on one channel.
- [ ] `packages/knowledge`: ingest (URL crawl + file upload) → chunk → embed → pgvector; Claude
      distills **Business Context**. UI: knowledge upload + context preview.
- [ ] `packages/ai`: LLM gateway over Claude. **Planner** → typed **Campaign Graph** from goal +
      context. **Reply classifier**.
- [ ] `packages/core`: Campaign Graph types + a deterministic graph executor spec.
- [ ] `apps/worker`: Temporal `CampaignWorkflow` — run step → durable wait → await reply **signal** →
      branch → update pipeline.
- [ ] `packages/channels`: adapter interface + **Email adapter** (SendGrid — subuser + dedicated IP) with deliverability validation.
- [ ] `apps/api`: inbound **webhook → EventIngest → classify → signal** the workflow.
- [ ] `apps/web`: Create-Agent wizard (goal + knowledge), Steps tab + **per-channel editor** (email),
      Leads list, pipeline view — all wired to live data.
- **Demo:** create an agent from a goal → it plans an email sequence → enroll a test lead → email
  sends → you reply → reply is classified → the journey **branches** and the lead **moves pipeline
  stage**, all visible in the UI and inspectable in Temporal.

## Phase 2 — SMS + WhatsApp (Week 2)
- [ ] Twilio **SMS adapter** (segments, **STOP/opt-out enforced**, sending windows, daily caps).
- [ ] **WhatsApp adapter** (approved templates + quick-reply buttons → buttons map to signals).
- [ ] Inbound SMS/WhatsApp webhooks → EventIngest → signals (replies branch the journey).
- [ ] Per-channel editors in UI (SMS char/segment counter; WhatsApp template + buttons).
- [ ] Compliance: consent capture, opt-out ledger, quiet hours per timezone.
- **Demo:** a mixed email→SMS→WhatsApp branching sequence with a real inbound reply on each channel.

## Phase 3 — The Voice agent (Week 2–3) — long pole
- [ ] `apps/voice`: Twilio Media Streams bridge → **Deepgram** STT → **Claude** brain → **TTS** loop.
- [ ] Voice tools: `send_booking_link`, `send_proposal`, `book_meeting` firing live integrations.
- [ ] "Voice call" node in the graph; call outcome/transcript → EventIngest → signal + pipeline move.
- [ ] Latency tuning (<800ms round-trip), recording + consent, call summary in the lead timeline.
- **Demo:** the agent places a real closing call, books a meeting and texts a booking link mid-call.

## Phase 4 — Chat widget + LinkedIn (Week 3)
- [ ] `apps/widget`: embeddable JS snippet → WebSocket → same brain + knowledge + capture/convert tools;
      can enroll a visitor or book them.
- [ ] LinkedIn adapter via the **`clientforce-chrome`** extension (extension = actuator over the API);
      restyle the extension to the design system.
- **Demo:** drop the snippet on a test page → chat captures + books a lead; capture a LinkedIn lead from the extension.

## Phase 5 — Pipeline, sender health, hardening (Week 3–4)
- [ ] Pipeline board + sub-campaigns; sender health/warmup; rate-limit + retry/backoff across adapters.
- [ ] Sender warmup + SPF/DKIM/DMARC checks surfaced in Campaign settings.
- [ ] Security review, load test, OpenTelemetry + Sentry, runbooks.
- [ ] Global standards pass (accessibility, states, responsiveness — see `CONSISTENCY_AUDIT.md §6a`).

## Phase 6 — Automations engine (Week 4)
- [ ] `packages/automations`: **When → Only-if → Then** evaluator consuming the event bus; triggers
      (replies, calls, forms, payments, LinkedIn, schedule), conditions, multi-action executors.
- [ ] Recipes / quick-start; per-rule enable toggle; **run history** + audit log.
- [ ] UI: Automations list, builder modal, detail drawer (per `Automations.dc.html`).
- **Demo:** a rule fires from a live event and performs its action, with a visible run record.

## Phase 7 — Integrations platform + Zapier + Webhooks (Week 4–5)
- [ ] `packages/integrations`: OAuth broker + token vault; provider adapters (HubSpot, Salesforce,
      Pipedrive, GCal, Calendly, Cal.com, Gmail, Outlook, SMTP, Twilio, WhatsApp, Slack, Stripe).
- [ ] **Outbound webhook dispatcher** (sign + retry every event) and **Zapier** app (triggers/actions).
- [ ] UI: catalog, connect wizard w/ event subscriptions, connection health, disconnect.
- **Demo:** connect a CRM → a booked call creates a deal; a webhook/Zap fires on a real event.

## Phase 8 — Lead Finder / Auto-Prospecting (Week 5)
- [ ] `packages/prospecting`: DB + Apollo search; **signal scraping** (job-change/hiring/funding,
      Reddit/LinkedIn/Twitter/forum), enrichment providers, **intent scoring**, scheduled daily refresh.
- [ ] UI: search + filters, person & signal cards, "what triggered this lead", auto-match to campaigns.
- **Demo:** run a prospecting search → high-intent leads surface and enroll into a campaign.

## Phase 9 — Contacts/CRM + Forms + Proposals + Widget (Week 5–7)
- [ ] `packages/contacts`: lists, segments, filters, bulk actions, timeline, **CSV import** (upload→map→review), tags.
- [ ] `packages/forms` + `apps/hosted`: builder, templates, design, **hosted public forms**,
      submission → event bus → routing to campaign/list (double-opt-in).
- [ ] `packages/proposals` + `apps/hosted`: builder, send (email/SMS/WhatsApp + tracked link),
      **hosted proposal page** with Pay (Stripe) / Book / Accept, view tracking → events.
- [ ] `apps/widget`: design + capture fields (CRM-mapped) + behaviour (booking/proposal questions) +
      routing + embed; runs the same agent brain.
- **Demo:** a hosted form + proposal + widget each capture/convert a real lead end-to-end.

## Phase 10 — Analytics + Billing/Credits + Agency (Week 7–8)
- [ ] `packages/analytics`: event warehouse + rollup jobs; dashboards (overview/engagement/
      deliverability/conversions/channels/agents/revenue), funnel, leaderboard, **export**.
- [ ] `packages/billing`: plans, **per-channel credit ledger/metering** (voice costs more), Stripe
      subscriptions + usage, invoices.
- [ ] Account Admin: workspaces, **client sub-accounts**, agency earnings, **agency payouts**, branding.
- **Demo:** an agency creates a sub-account, it consumes credits, analytics + earnings reflect it.

## Phase 11 — Full hardening & launch (Week 8+)
- [ ] End-to-end security & pen-test pass, data export/delete (GDPR), backup/restore runbooks.
- [ ] Load test the event bus + Temporal at volume; cost review (AI + voice + infra).
- [ ] Full a11y + states + responsiveness sweep across every screen.
- **Outcome:** a genuinely production-grade platform — real value end to end.

---

## First tasks to hand Claude Code (in order)
1. "Scaffold the Turborepo monorepo per `ARCHITECTURE.md §5`."
2. "Create the Prisma schema with the **Agency→Workspace→User** hierarchy + `workspace_id` on every model + RLS."
3. "Stand up the NestJS API with auth + agency/workspace tenant middleware + health check."
4. "Build the internal **event bus** + typed event catalog (`packages/events`)."
5. "Author the `CampaignGraph` types in `packages/core` and a unit-tested graph executor."
6. "Implement the Temporal `CampaignWorkflow` (timers + reply signals + branching) with a fake adapter."
7. "Build the knowledge ingestion + Business Context distiller in `packages/knowledge`."
8. "Implement the Claude Planner: goal + context → CampaignGraph."
9. "Build the Email adapter + inbound webhook → event bus → classify → signal."
10. "Wire the Create-Agent wizard + Steps editor + Leads/pipeline UI to the API."
→ **As executed, Phase 0 = `EXECUTION_PHASE0.md` T0–T8** (steps 1–5 above **plus** the design-system
foundation, the web shell, infra-as-code + deploy, and seed + smoke — all merged). Steps 6–10 are
Phase 1, the working email slice, executed per `PHASE1_ISSUES.md` P1.1–P1.7 as amended by
`PHASE1_HANDOFF.md §B–§C`. Subsystems (Automations, Integrations, Lead Finder, Forms, Proposals,
Widget, Analytics, Billing) follow as Phases 6–10, one PR per task.

## Risks to watch
- **White-label tenancy** — the Agency→Workspace→User hierarchy must be right in Phase 0; retrofitting tenancy is brutal.
- **Billing & credits** — metering, Stripe usage, and agency payouts are money-critical; test exhaustively, reconcile against Stripe.
- **Voice latency & cost** — prototype the Twilio↔model loop early (spike in Phase 1 if possible).
- **Deliverability/compliance** — warmup + consent aren't optional; treat as first-class.
- **Planner output discipline** — constrain the Planner to a strict schema; validate every graph before it runs.
- **Event-bus coupling** — version event payloads; a bad event shape ripples into automations, integrations & analytics.
- **Scope creep** — the platform is large; ship the email slice first, then one subsystem per phase — never all at once.

# Remaining Product Decisions

> A small set of product choices that **refine** the build but don't block Phase 0. Each has a
> recommendation and a place to record your call. Once decided, they feed `DATA_MODEL.md` (limits,
> credit prices, pipeline stages) and the relevant subsystem phases. The matching questions are being
> asked in chat — your answers drop straight in here.

---

## D1. Credit pricing per channel
Credits meter usage (`CreditLedger`, `DATA_MODEL.md §7`). Voice and enrichment cost real money, so they
should cost more credits. Proposed starting model (1 credit ≈ your unit; tune to margin):

| Action | Proposed credits | Notes |
|---|---|---|
| Email send | 1 | cheapest |
| SMS segment | 3 | + carrier pass-through |
| WhatsApp message | 3 | template fees vary |
| AI voice call | 25 / min | STT + LLM + TTS + telephony — the expensive one |
| Lead enrichment | 5 / contact | provider cost |
| Auto-prospect signal lead | 10 | scraping + enrichment + scoring |

**DECIDED:** Pricing must be **editable from an admin interface** (not hard-coded) — modeled as the
`CreditPrice` table in `DATA_MODEL.md §7` (platform default + per-agency override, effective-dated).
Seed values from **studied market rates of the providers we use (SendGrid, Twilio, Deepgram, TTS,
Apollo/PDL) + a small markup**. The proposed table below is the seed; change anytime via UI.

## D2. Plan tiers & limits
**DECIDED:** **3 plan tiers**, set **only at the Agency (top) level** — workspaces inherit the agency's
plan (no per-workspace plan). Tiers seeded as `STARTER / GROWTH / SCALE` (`DATA_MODEL.md §1`; rename
freely). Per-tier limits (agents, sending volume, seats, included credits) TBD — set in the billing UI.
**Note:** the white-label model is now **Agency → Workspace(client) → User** — the "reseller / reselling
Clientforce" framing and agency-payouts are **dropped/deferred to v2**; v1 billing = the agency pays
Clientforce. Branding lives at the agency level.

**Open (non-blocking):** exact limit numbers per tier.

## D3. v1 integrations (which ship first)
Full catalog is in the prototype; v1 should be the ones the agent loop actually needs:
- **Recommended v1:** SendGrid (email), Twilio (SMS/WA/voice), **Google Calendar + Calendly** (booking),
  **Stripe** (payments), **Slack** (alerts), **Zapier + Webhooks** (everything else), **HubSpot** (first CRM).
- **v2:** Salesforce, Pipedrive, Cal.com, Outlook/Microsoft 365, custom SMTP.

**DECIDED:** Confirmed — ship the recommended v1 set; the rest follow in v2.

## D4. Lead Finder — signal sources *(you offered detail here — please be specific)*
The prototype shows **DB + Apollo** search and **signal-based intent discovery**. To build it concretely
I need the real sources and providers. Please specify:
- **B2B contact/company data + enrichment:** Apollo? (already implied) ZoomInfo, Clearbit, People Data
  Labs, Hunter — which do you have/want? API keys available?
- **Intent / event signals:** which of these, and via what provider/API —
  - job-change & hiring-surge (LinkedIn? a provider?)
  - funding/growth alerts (Crunchbase? news?)
  - social/forum posts (Reddit, X/Twitter, forums) — own scrapers or a provider?
  - "intent data from 5,000+ sources" (Bombora-style provider, or your own aggregation?)
- **Refresh cadence:** daily (prototype says "live daily refresh") — confirm.
- **Compliance:** any sources with ToS limits on scraping we must respect (esp. LinkedIn)?

**DECIDED:**
- **Contact data / enrichment:** **Apollo + People Data Labs** (both; dedupe/merge across them).
- **Intent signals:** a **mix across APIs + social + news** (job-change, hiring surge, funding/growth,
  social & forum posts, aggregated intent) — as the prototype shows. **Build adapters for all relevant
  sources** by studying each provider's docs, behind one normalized `SignalSource` interface.
- **Approach:** the team will **obtain any API key on request** — so the build should implement each
  integration and then **emit a clear "keys needed" list** per source. **LinkedIn:** implement strictly
  **within their ToS/constraints** (no prohibited scraping; use compliant/official paths).
- **Cadence:** **decided for us → daily scheduled refresh** for prospecting runs, with first-party/
  inbound signals processed continuously (real-time via the event bus).

**Action for Claude Code:** design `packages/prospecting` with a pluggable `SignalSource` adapter
interface; implement Apollo + PDL + the signal adapters; surface a generated **"required API keys"**
manifest the team fills in. Respect per-source rate limits + ToS (LinkedIn especially).

## D5. Default pipeline stages
`PipelineStage` needs sensible defaults (overridable per campaign). Proposed:
`New → Contacted → Engaged → Interested → Booked → Won → Lost`.

**DECIDED:** Use the proposed default stage set.

## D6. AI model defaults & fallbacks
Claude is the brain (locked). Worth pinning per task:
- **Planner / copywriter / classifier:** which Claude model (e.g. latest Sonnet for cost/speed, Opus for planning?).
- **Voice brain:** Claude via the realtime loop; confirm STT = Deepgram, TTS = ElevenLabs **or** Cartesia.
- **Fallback policy:** on provider outage, degrade how (retry, queue, secondary model)?

**DECIDED / RECOMMENDED:**
- **Planner:** Claude **Opus**-class for the planning step (quality matters most there); **Sonnet**-class
  for copywriting, reply classification, and the voice brain (cost/latency). All behind the swappable gateway.
- **Voice:** STT = **Deepgram**; **TTS = Cartesia** (recommended — lowest latency for realtime, key for the
  <800ms budget), with **ElevenLabs** as the quality/fallback option.
- **Fallback:** retry with backoff → queue → secondary model on sustained provider outage; never drop a lead's workflow.

## D7. Compliance posture (region & consent)
**DECIDED:** Primary markets = **US, Australia, Canada**. This drives:
- **US:** TCPA (SMS consent + STOP), CAN-SPAM (email unsubscribe).
- **Canada:** **CASL** — strict **express consent** for commercial messages; this is the tightest bar.
- **Australia:** Spam Act (consent + unsubscribe) + Do Not Call register for voice.
- **Call recording:** consent handling per state/province; announce + store consent.
- **Double opt-in (forms):** **decided for us → per-form setting, defaulted ON** (satisfies CASL cleanly;
  can be turned off per form where not required).
- **Retention:** transcripts/recordings default **12 months** then purge (configurable per workspace); GDPR-style export/delete supported even though EU isn't a primary market.

*(No EU/GDPR primary targeting — but build data export/delete anyway; it's cheap insurance and table stakes for investors.)*

---

### How these map to the build
- D1, D2 → `billing` package + `Plan`/`CreditLedger` (Phase 10) — but seed sensible values in Phase 0.
- D3 → `integrations` (Phase 7) ordering.
- D4 → `prospecting` (Phase 8) — **the one that most needs your input to even start.**
- D5 → seed in Phase 0 (`PipelineStage`).
- D6 → `ai` gateway config (Phase 1).
- D7 → guardrails + compliance, woven through Phases 1–3.

None of these block T0–T8. D5 and sensible D1 defaults get seeded in Phase 0; the rest land as their
subsystems come up. **All seven are now decided** (D4 captured Apollo + PDL + a pluggable signal-source
framework; D2 collapses to Agency→Workspace), so the only remaining inputs are non-blocking numbers
(per-tier limits) and the API keys the team will supply on request.

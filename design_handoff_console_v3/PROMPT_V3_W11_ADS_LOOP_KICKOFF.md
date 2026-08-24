# PROMPT — V3 W11 ADS CLOSED LOOP KICKOFF (add-on: new product, own flag)

You are continuing the clientforce-platform build. Read `PROGRESS.md` (Status table + last 30 ledger entries), `design_handoff_console_v3/README.md`, then `ADDENDUM_3_ADS_LOOP_UI.md` BEFORE any code. This unit builds the **Ads Closed Loop add-on** — NEW product, not a restyle. Protocol: PHASE1_HANDOFF §E; conflicts → DEC/Q in PROGRESS.md, never a silent choice.

## Contract
- Flag `adsLoop`, nested under `consoleV3`, per-workspace, default OFF. Zero edits to legacy screens/routes. Additive-only on shipped endpoints.
- Entitlement gate: one workspace-scoped `ads_loop` entitlement, **$49/mo, covers Meta AND Google**. Second provider connects free. Mirror the Receptionist entitlement plumbing — do not invent a parallel mechanism.
- Provider health/status reuses the shipped integrations registry (integrations.ts, DEC-093). One registry only.
- Compliance is a review gate, not a nicety: consent captured at capture time · SHA-256 hashing before any upload · audiences scoped to one client · no cookie data, no cross-client audience sale. A PR without these fails review.
- Atoms: DESIGN_TOKENS_V3.md. Composition/copy: `prototypes/Clientforce Console.dc.html` → Integrations → Meta Ads / Google Ads. Click every tab and both states (unentitled showcase, connected view) before writing UI.

## Scope A — surface (apps/web, /v3)
1. **Integrations page**: Meta + Google in ONE bordered ads group above/apart from the 7 providers, each row labelled `ADD-ON · $49/mo covers both` + `value passback free`. Greyed **Ads Closed Loop** teaser at page bottom → **Watch** opens the film sheet.
2. **Showcase** (unentitled): full-page marketing surface in Clientforce logo blues/greens (NEVER Meta-blue/Google-red). Hero with no stat strip → seven value cards → moat section → compliance line → single $49 footer + CTA. Value section scrolls in its own container. **Suppress the Ada bar on this page while unentitled.** Customer-facing copy only.
3. **Setup**: in-page portable container (~640px, centred, radius 20) — 5 steps: ad account → OAuth authorize (list the real scopes per platform) → map lead forms → consent + hashing acknowledgement → go live. Never a full-bleed takeover.
4. **Connected view**: 8 tabs — Closed loop · Ad leads · Value ledger · Audiences · Per-ad truth · Objections · ✦ Suggestions · Health. Every tab renders live data (contracts in ADDENDUM_3 §E). Forest-active tab rail per tokens.
5. **Film**: component with the ADDENDUM_3 §H chapter table (8 chapters, 90s, play/pause/seek, m:ss / 1:30). One tick drives one `t`; pause freezes via a single class on the stage.
6. **Owned banner** on the second provider: `You already have Ads Closed Loop on this workspace — the $49/mo covers both Meta and Google, so this one connects free.`

## Scope B — data + jobs (apps/api, packages/core)
Tables per ADDENDUM_3 §I: `ad_context` · `click_id_store` · `value_passback` · `audience_sync` · `ads_suggestion` + `ads_loop` entitlement.
1. **Inbound**: Meta Lead Ads + Google Lead Forms webhooks → contact + `ad_context` (campaign→adset→ad→creative + typed answers) on the contact timeline. Ada's opener may quote the ad — the brain reads ad_context like any other context row.
2. **Click-ID capture**: widget + hosted forms + pages read gclid/fbclid/UTM on landing, store with consent flag, join to contact on identify. Widget opens on the ad's offer, not a fresh greeting (widget change is additive — no behavior change when `adsLoop` is OFF).
3. **Passback**: booked/sold/won receipts → Meta CAPI + Google offline conversions carrying `v_est_cents` (the value model from ADDENDUM_2 — never a flat "lead" event). Idempotent, retried, ack recorded. FREE — never metered.
4. **Audiences**: nightly job maintains four lists from goal state (Booked→exclusion, Interested-no-book→retarget, Won→lookalike seed, suppression→never-target), syncs per client, **charges credits per job** via the credit_ledger (ADDENDUM_2 §D).
5. **Per-ad truth**: pull spend from the ads APIs, join on click-ID, expose cost-per-booking per creative to console + client report.
6. **Objection intel**: existing reply classifications grouped by adset → creative implication rows. No new classifier.
7. **Suggestions**: read-only ad account access → proposals only. `approve-to-act`, receipt per action, nothing mutates budgets autonomously.

## Acceptance (attach to PR)
- Screenshot pairs proto-vs-port: ads group on Integrations · greyed teaser · showcase top + value section scrolled · setup steps 1/3/5 · connected view for ALL 8 tabs · owned banner on second provider · film sheet at 2 chapters.
- `adsLoop` OFF → Integrations page byte-identical to W6 output; widget behavior unchanged. ON → showcase → setup → connected view walks end to end on seeded data.
- Passback unit tests: value carried, hashing applied, idempotency on retry. Audience job test: credits charged once per run.
- Legacy e2e green. PROGRESS.md entry with DEC/Q log.

## Known trap (cost the design team an hour)
Cards inside a `flex-direction:column; overflow-y:auto` detail pane MUST carry `flex:none`. Without it the tallest panel collapses to ~2px and its content is clipped by overflow — present in the DOM, invisible on screen. Check every detail pane you build.

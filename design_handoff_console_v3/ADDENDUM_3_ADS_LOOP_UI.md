# ADDENDUM 3 — Ads Closed Loop add-on surface + polish (2026-08-15, after the Addendum-2 export)
Delta only. Everything in ADDENDUM_2_CREDITS_VALUE.md still stands; where this doc and any earlier text disagree, THIS DOC WINS. Prototypes in /prototypes are refreshed to this state.

## A. Pricing correction (supersedes every earlier line)
ONE add-on entitlement — **Ads Closed Loop, $49/mo per workspace, covering Meta AND Google**. Connecting the second platform costs nothing extra. Any copy implying a per-platform fee is retired.
- Entitlement is workspace-scoped (`ads_loop`), same shape as the Receptionist entitlement.
- Metered on top: audience-sync jobs and ad-lead enrichment burn credits. Value passback is FREE (it makes the client richer and us stickier).
- Prototype strings to port verbatim: group row label `ADD-ON · $49/mo covers both` + `value passback free`; showcase footer `$49 / mo per workspace — one add-on, covers Meta and Google`; owned banner `You already have Ads Closed Loop on this workspace — the $49/mo covers both Meta and Google, so this one connects free.`

## B. Integrations page composition (changed)
1. **Ads group**: Meta Ads + Google Ads sit together in ONE bordered container, visually separated from the 7 shipped providers, each row carrying an ADD-ON label. They are not peers of Stripe/HubSpot in the grid.
2. **Provider grid**: bolder section headings, tighter measure — cards do not stretch edge-to-edge.
3. **Ads Closed Loop teaser** sits at the PAGE BOTTOM, both platform tiles greyed (grayscale logos, .5-opacity skeleton), single action = **Watch** → the 90-second film sheet. It explains, it does not sell inline.

## C. Add-on showcase (new surface type)
Clicking Meta or Google while unentitled opens a **full-page marketing showcase** — same class of surface as the Receptionist add-on page, not a settings pane.
- Palette: the **Clientforce logo blues/greens**, NOT Meta-blue / Google-red. Platform brand colors were tried and rejected (owner, 2026-08-15).
- Structure: hero (claim + the one-line loop, NO stat strip — the earlier `$19.2k / $38→$210 / 4 lists` hero row is removed) → the value story (all seven angles, each a card: ad context into openers · widget as ad concierge · audience engine · value-based bidding · per-ad ROI · objection→creative intel · Ada as media copilot) → where-the-moat-is section → compliance line → single price footer + CTA.
- The value section **scrolls inside its own container**; it must never be height-clipped (see §F).
- The **Ada bar is suppressed** on an unconnected showcase — the pitch owns the page. It returns once connected.
- Copy rule: showcase copy is written FOR THE CUSTOMER. Internal notes (pricing mechanics, "rails", strategy asides) never render — they were leaked into the UI once and removed.

## D. Setup wizard (changed)
Setup happens **on the page in a portable container** (max ~640px, centred, radius 20), never a full-bleed takeover: 5 steps — choose ad account → authorize (OAuth scopes listed per platform) → map lead forms → consent + hashing acknowledgement → go live. Scope lists are per-platform and explicit (e.g. Google: read campaigns/spend, upload offline conversions hashed SHA-256, manage this client's custom audiences only).

## E. Connected ("running") view — 8 tabs
Tab rail, forest-active per DESIGN_TOKENS_V3 tabs rule. Each tab needs live data; the prototype carries a working sample of every one:
| Tab | Shows | Data contract |
|---|---|---|
| Closed loop | the four-stage loop with live counts per stage | aggregate per 30d |
| Ad leads | lead rows with campaign→adset→ad→creative + typed form answers + Ada's opener quoting the ad | ad_context per contact |
| Value ledger | receipted events pushed back with dollar value, status per event | passback ledger (event, v_est, platform ack) |
| Audiences | the four auto-maintained lists + last sync + size delta | audience_sync jobs |
| Per-ad truth | spend ÷ receipted value = true cost per booking, best→worst creative | ads API spend joined on click-ID |
| Objections | reply classifications clustered per adset, with the creative implication | reply_classification joined on ad_context |
| ✦ Suggestions | Ada's media proposals (scale/pause/nurture) — approve-to-act, receipt line each | suggestion queue, guardrailed |
| Health | webhook subscriptions, token validity, last event, backfill state | provider health |

## F. Port-critical defect found while building (read before porting ANY detail pane)
The integration detail column is `flex-direction:column; overflow-y:auto`. Card children default to `flex-shrink:1`, so the tallest panel collapsed to **2px** and its content was clipped by `overflow:hidden` — text present in the DOM, invisible on screen. **Every card/strip in a scrolling flex column needs `flex:none`.** Applies to all detail panes in the port, not just ads.

## G. Settings & Business core header (changed)
The business page now opens with a centred header block: 48px mint gear tile with soft green glow → **"Settings and Business core"** at 34px/900, tracking −.04em, gradient ink → one-sentence description of what the section governs ("Everything the agents work from … Ada reads this before she writes a single message") → status pills (core complete / knowledge gaps). Back arrow floats at the left edge. The business name appears ONCE, in the identity strip below — the duplicate in the header is removed.

## H. Film asset — "Ads Closed Loop · 90 seconds"
A built animation, not a video file: dark sheet (rgba(8,11,20,.62) + blur), 680px stage, 16/9, play/pause, chapter chips (click to seek), `m:ss / 1:30` readout, progress bar.
8 chapters, durations in seconds: The gap 10 · 01 Context arrives 12 · 02 Mid-pitch 10 · 03 Audiences 12 · 04 Value goes back 16 · 05 Per-ad truth 10 · 06 Objections 10 · 07 You approve 10.
Driven by one 200ms tick over `filmT` (0–90) with per-chapter progress `p`; 18 `flm*` keyframes (flmIn/InL/InR, Pop, Drop, Fly, Bar, Rise, Pulse, Ring, Dash, Type, Cut, Float, Sweep, Blink, Cursor, Stamp); pause = one class on the stage that freezes all children. Port as a component with the same chapter table; if the app later has a real recording, swap the stage and keep the shell.

## I. Backend additions (extend BACKEND_TOUCH_MAP §NEW)
- `entitlement` row `ads_loop` (workspace-scoped, one per workspace, covers both providers) — mirrors receptionist entitlement plumbing.
- `ad_context` (contact_id, provider, campaign/adset/ad/creative ids + names, form answers json, click_id, captured_at) — written by Meta Lead Ads / Google Lead Forms webhooks AND by widget/form click-ID capture.
- `click_id_store` (gclid/fbclid/utm bundle, landing url, consent flag, ts) → joined to contact on identify.
- `value_passback` (event_id, kind booked|sold|won, v_est_cents, provider, hashed identifiers, platform_ack, retry state) → Meta CAPI + Google offline conversions.
- `audience_sync` (list_kind booked_exclude|interested_retarget|won_lookalike|suppression, provider, last_run, size, delta, credits_charged) — nightly job, credits metered.
- `ads_suggestion` (kind, payload, receipt, state proposed|approved|rejected) — approve-to-act only; nothing touches budgets autonomously.
- Provider health reuses the shipped integrations registry pattern (integrations.ts, DEC-093) — do NOT invent a second registry.
Compliance (non-negotiable in code review): consent captured at capture time, identifiers SHA-256 hashed before upload, audiences scoped per client, no cookie data and no cross-client audience sales — ever.

## J. Wave placement
Ads Closed Loop is **NEW product, not skin** → its own wave and its own flag `adsLoop` (nested under `consoleV3`), dispatched by PROMPT_V3_W11_ADS_LOOP_KICKOFF.md. The W6 integrations wave ports the provider grid + ads GROUP CHROME ONLY (greyed teaser, showcase route stub) so the page composition is right without the product behind it.

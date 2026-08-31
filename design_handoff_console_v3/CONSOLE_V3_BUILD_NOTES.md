# Console v3 — Build Notes (new context introduced by the UI)

> Companion to `CONSOLE_V3_CANON.md` (visual canon) and the console prototype files.
> This file logs **behaviour and data that the UI introduces which is NOT yet in the
> shipped engine**, so Claude Code receives accurate context alongside the mocks.
> Canon = how it looks. This = what it must now do.
>
> Ledger convention: each item marked **NEW** needs a build unit; **SURFACING** means
> the engine already does it and the UI only exposes it (no new logic).

---

## 1 · Campaign creation

### 1.1 Audience relationship → opener selection — **NEW**
Every audience source carries a `relationship` attribute: `prospects | customers | mixed`.
- Asked explicitly after a CSV import; inherited from a list's own stored relationship.
- **Effect:** shifts the *opener role* of the derived arc — cold-open (earn the ask) for
  prospects, warm-reference (remind, don't pitch) for customers, per-contact detection for mixed.
- Layered **on top of** the derived arc (`goal × business-category`, DEC-065) — it does not
  replace arc selection. Owner ruling: opener only, nothing further.

### 1.2 High-ticket signal — **NEW (narrow)**
- Lives in **Business Core** as an offer-value attribute, inherited by every campaign.
- Only *applied* for direct-product-sale goal types (`promote_offer`, and upsell where a
  price point exists). Inferred from the distilled price signal; asked only if absent.
- **Effect:** cadence + tone weighting (longer consideration, proof-led, financing-forward).
- Owner ruling: never a per-campaign user control — the engine derives, the UI displays read-only.

### 1.3 Channel gating — **NEW**
- Channel selection reads each channel's real configuration state.
- Unconfigured channels render disabled with an honest reason ("WhatsApp Business not connected")
  and **cannot be selected**.
- Owner ruling: **no inline channel configuration inside campaign creation** — it duplicates
  Business Core / Integrations setup. Disabled + a pointer only; the user never leaves the flow.

### 1.4 Derived strategy shown read-only — **SURFACING**
The plan displays `business-category · arc · tone` (+ high-ticket chip where 1.2 applies).
No control. Purely exposing `packages/core/strategy.ts`.

### 1.5 Branch preview at creation time — **SURFACING**
The plan shows the branch map before launch, using the real intent vocabulary:
`interested · objection_price · objection_timing · question · not_interested`
plus `no reply · 7d` and `sequence quiet · 30d`. No new classification work.

### 1.6 Brief editing — **SURFACING**
Guided-mode briefs are editable per step in the Plan modal (objective text, not copy).
Maps to the existing brief field; composition still happens at send.

### 1.7 Extra context box — **SURFACING**
One optional free-text field → existing `strategyNotes` (500 chars into the planner).

### 1.8 Credit estimate at review — **NEW**
Pre-launch estimate broken down per channel (email/SMS/voice) against workspace balance,
priced from the admin-editable `CreditPrice` table (D1). Needs a per-campaign projection
endpoint: enrolled × steps × per-channel price, voice by projected minutes.

### 1.9 Guardrails condensed into review — **SURFACING + NEW surface**
Review shows and can edit: daily cap, per-contact touches, quiet hours, sending days,
tracking toggles. `unsubscribeFooter` and `suppressionCheck` render **locked on** —
they are literal-`true` in the engine and must be un-switchable in UI too.
Approval-before-send shown as required.

---

## 2 · Suggested campaigns — **NEW (the significant one)**

Ada proposes campaigns unprompted in the rail, marked ✦. This is **not** a fixed catalogue —
it is a generative surface, and the build must treat it as such.

**Each suggestion must carry, generated from real workspace signal:**
1. `signal` — the observed fact that triggered it (counts, recency, gaps), citable.
2. `why` — the reasoning, in business terms (value at stake, expected conversion basis).
3. `audience` — a **resolved** audience: the actual list/segment, already narrowed and
   suppression-checked, not a prompt to go choose one.
4. `goal` — mapped to an existing goal type so the arc derivation still applies.
5. `plan shape` — the sequence the suggestion *demands*: channels, step count and cadence
   follow from the signal, not from a template. A review request is short and SMS-led;
   a lapsed recall is longer, email-led with a voice step.

**Behaviour rules:**
- Entering creation from a suggestion **skips the goal question** — it is already known.
- Ada opens by stating her reasoning and the audience; the user **confirms** rather than chooses.
- The audience is pre-selected and browsable (scrollable contact preview), and the user may
  stack more sources or swap it.
- Ada must never ask for something she has already stated — treat a re-ask as a defect.
- **The suggestion set is open-ended.** Use cases cannot be enumerated; the agent derives each
  suggestion's whole flow from the signal it found. Any hard-coded suggestion list is wrong.

**Suggestion sources (signals to mine):** overdue recalls, completed visits without a review,
stalled proposals, unworked ICP matches, quiet campaigns, seasonal/event windows, capacity gaps.

---

## 3 · Cross-console additions

- **Chatbot rename** — "Widget" is called **Chatbot** everywhere in v3 (surface, nav, copy).
  Internal package/code names may stay `widget`.
- **Capture sources are one consolidated surface** — each source (Chatbot, Hosted form,
  BuyerPing add-on) is a single card that expands in place with its own picker and live preview.
  Enrolment from either source flows straight into the campaign.
- **Ada is the creation and action surface** — internal pages are inspect + light-edit;
  creation and material change flow through Ada so her picture of state stays true.
- **Launch celebration** — full-screen confirmation with enrolled/steps/credits.

---

## 4 · Owner rulings recorded (do not re-litigate)

| Ruling | Decision |
|---|---|
| Channel setup inside creation | No — disable + point, never inline |
| Per-campaign tone/cadence control | No — derived; display read-only |
| High-ticket location | Business Core, applied only to product-sale goals |
| CSV relationship scope | Opener only |
| Suggestion catalogue | Open-ended and generated; never a fixed list |
| Locked compliance rows | `unsubscribeFooter` + `suppressionCheck` un-switchable in UI |

---

### Focus mode — click-only (owner, Aug 12)
Auto-collapse retired entirely (25s timer + hover-collapse removed). The rail opens via
the slim strip; collapsing happens ONLY via the new "« Focus" button in the rail header
— same slow zoom choreography (rail fades, campaign grows via cfApproach, dock folds).
Refresh polish: rail header is Schibsted 800 ("Campaigns" + count pill), surface titles
25px/900, metric tiles 28px, stat tiles 25px — the bolder account-page feel. "« Focus"
lives in the RAIL HEADER (logo row, next to the workspace switcher). Campaign status
band is SOLID FOREST (#146B33, #0F5227 border, gradient top edge kept): white Schibsted
title + translucent goal chip, white mono status line, a big BOOKED number inside the
band, translucent Needs-you pill, and a goal-progress bar (gradient fill = the one
gradient moment) with "N booked of T — P%" mono caption; tabs sit on the band (active =
white pill w/ forest text, inactive white/82), gear matches. Goal numbers live on
campaignDefs (booked/target per campaign).

## 5 · Receptionist — inbound add-on (dock presence) — **NEW**

Named **Receptionist** (over "Front Desk" / "Switchboard": names the job, is the category
buyers search, fits the agent vocabulary). Positioning: **the inbound counterpart to
campaigns** — a standing answerer on the workspace's existing tracked number. Not a
campaign: no enrolment, no sequence; it reacts to calls.

**Surface (v3 console):**
- Standalone branded tile ABOVE the icon dock in its own frame — a product, not a nav
  item. Own mark: gradient rounded square + headset glyph in dark ink (the gradient mark is
  the add-on's logo moment, per the logo-mark exception); greyscaled while locked. Presence
  dot = line state (forest on / grey paused). Incoming call
  = pulsing ring on the tile + pop-out call card (top-right, mirrors Ada's bottom-right
  anchor). All Receptionist UI is pop-outs (add-on card ~330px · setup wizard ~360px ·
  control panel ~360px · call card ~340px); deliberately NO full-page surface. The panel
  is multi-view with back-nav: home → All calls (full log + weekly totals) → per-call
  detail (caller match, WHEN/LINE/RESULT/COST rows, full transcript) · home → Rules editor
  (pickup-mode radios + permission toggles, "Done" footer; same controls as setup ②–③).
- Locked state is quiet: muted icon, no badge; the add-on card appears only on click.

**Add-on gating:** tile starts locked → click opens the add-on card ($29/mo is a
**placeholder — owner prices it**; voice minutes bill from credits at 15 cr/min per
COST_MODEL; missed-call text-back consumes SMS credits). **Adding launches a 3-step
onboarding pop-out:** ① which line — existing tracked number or dedicated (+$1.15/mo) ·
② when it picks up — 24/7 / after-hours & missed / overflow (4 rings) · ③ permissions —
book / route / text-back toggles → “Go live”. Defaults derive from Business Core; closing
the wizard = live on defaults; the panel's HOURS rule reflects the step-② choice. Rules
remain editable from the panel.

**Engine work this implies (build unit; none of this is in the shipped engine):**
1. Inbound voice agent: answer + AI disclosure, grounded in the business brain; book /
   route / take message; outcome classification.
2. Outcomes land on the contact timeline AND Needs you (messages); caller matched against
   contacts — known-contact context shown while ringing.
3. Missed/after-hours → SMS text-back automation (1-minute SLA).
4. Per-workspace inbound config: hours, booking types → calendar, routing target, line
   pause toggle.
5. Live listen-in / mid-call take-over needs an audio bridge — **v2 candidate**; ship
   answer/book/message/route first. "Take it myself" during ring = plain forward (v1).
6. **Action permission layer:** one master "act through integrations" toggle gates ALL
   integration writes (calendar booking, payment links, CRM updates) — wired to the SAME
   action/integration registry campaign agents use; one permission model, never a
   Receptionist-only matrix. Scoped to integrations already connected. OFF = speak-only:
   still answers, routes and takes messages, writes nothing (BOOKING rule shows paused).
   Surfaced as the ACTIONS rule row (panel, inline toggle) + a step-③ permission row.
7. Billing: add-on SKU as a Stripe line item (BuyerPing precedent); voice minutes meter
   against credits as today.
8. **Call log + transcripts:** every call stores caller match, result line, duration,
   credits and full transcript (text-backs store the SMS). Surfaced in-panel; also feeds
   Inbox's Calls filter. **Flag for legal review before build:** call recording/transcript
   consent — TX is one-party, but two-party-consent states (CA, FL…) need a disclosure
   line in the greeting; retention window is a build decision.

**Provenance rules:** discloses AI on every call — un-switchable, same class as
`unsubscribeFooter`; ✦ on every AI-handled outcome row.

**Mock behaviour:** add-on card → 3-step setup → panel; "Preview a call" simulates ring
(4s) → live transcript → booked outcome; `receptionistAdded` tweak presets the add-on
active (skips onboarding, as an already-onboarded workspace).

---

## 6 · Console batch A (2026-08-12 owner voice-note)

### 6.1 Suggested-campaign provenance — **NEW (small)**
A campaign created from an Ada suggestion stores `sourceSuggestionId`; UI: ✦ glyph on the
rail card + "✦ Ada-suggested" pill in the status band. Never user-editable.

### 6.2 "Ada's read" overview card — **NEW**
Generated 2–3 sentence narrative (pace vs goal · best-converting channel · one watch-out),
a NEXT UP line (next scheduled sends/calls from the real queue), and the derived strategy
chips (arc + tone, read-only — strategy.ts DEC-065 surfacing). Engine: summary composer on
a cheap model + next-scheduled query; regenerates on material events, not per view.

### 6.3 Selected campaign → canvas "speech bubble" — canon
Selected rail card grows a mint bubble tail toward the canvas (the campaign "opens out"
into the console). Pure CSS; recorded in CONSOLE_V3_CANON §8.

### 6.4 Settings entry — canon
The hidden gear is now a labeled "⚙ Settings" chip, right side of the tab row, in the
slate-teal family (#356170/#EAF3F5) so it reads as a different class from content tabs.

### 6.5 Settings tab: AGENT STRATEGY & VOICE — **SURFACING (repo truth)**
New first section renders, verbatim from the shipped engine: selling arc (label +
description + 4-role ladder; ✦ derived read-only, goal×category — `strategy.ts` DEC-065)
· category tone line · agent output language + source (DEC-072) · voice persona ·
strategyNotes (500-char, shown with count) · neverSay chips (10 max, prompt + post-gen
check) · locked opener discipline row (≤70 words, BANNED_OPENERS/BANNED_SUBJECT_PATTERNS,
deterministic post-compose check — G2 DEC-071). Only notes/neverSay/language/persona are
editable; arc + tone + opener rules are display-only.

### 6.6 Agent activity ledger — **NEW surface over existing events**
Overview "Recent activity" rows are richer (kind pill + receipt time) and all clickable;
"View all →" opens the Agent Activity page (NOT a top tab — reachable only from View all).
Page: filter chips (All/Sends/Replies/Bookings/Decisions ✦/Voice/Automations), day-grouped
rows, each row expanding inline to a receipt (WHAT/WHY rows + object links: contact, thread,
step, guardrails) and cross-navigates. Data = existing bus events + rule-run records
(`automation.rule.run.v1`, sends, replies+classification, calendar writes, guardrail
holds/suppression blocks, enrichment) — needs one paged/filterable activity endpoint.
Blocked/held events display honestly (suppression block, cap hold, quiet-hours defer).

### 6.7 Plan tab — step detail, add-step, delays, schedule
- **Step detail modal** (click any step card): email = subject + deterministic checks
  (length band, banned-pattern check G2, token count, preview-text warn), brief/body with
  arc-role row, send window, credits math, tracking; SMS = segment math + locked opt-out
  footer; voice = call plan, locked AI disclosure, minute cap ≈ credits. SURFACING of
  composer checks; the modal itself is NEW UI.
- **Add step** now really appends (channel step + default 2-day wait) — WhatsApp renders
  disabled "not connected" (honest absence, FR-PLAN-05). Ada drafts the new step's brief.
- **Delays clickable** → wait picker (4h–1wk); **schedule chip** → window + timezone
  picker. Both feed the plan header line.

### 6.8 Reply classification card — **SURFACING**
Branches view lists the live intent vocabulary (interested / objection_price /
objection_timing / question / not_interested) with per-intent behaviour + weekly counts,
and the honest-escalation footer (unclear → Needs you, never guess).

### 6.9 ✦ Suggested automations — **NEW (generative, like §2)**
Under Branches & rules: signal-grounded automation suggestions in the R1 (DEC-074)
When→Then vocabulary ONLY — real triggers (meeting_canceled, reply_classified,
before_meeting…) and real actions (move_to_node, notify_team, send_payment_link — a
mustSay flag, never a send). Each card: WHEN/THEN + ✦ why (cited signal) + Add/Dismiss;
Add creates an enabled CampaignRule with `seededFrom: 'suggestion'` and the rule appears
in the rules list with its toggle. Same behaviour rules as suggested campaigns (§2):
open-ended, never a fixed catalogue; only actions whose integrations are connected.

---

## 7 · Console batch B (2026-08-12) — de-duplication + the two inboxes

### 7.1 Branches view de-duplicated — owner ruling
The interested-move and quiet-30d rules WERE rendered twice (branch card trigger + rules
list). Ruling: **a branch's trigger rule renders ONLY on its branch card** ("this card IS
the rule"); the standalone list holds housekeeping rules only (booked → converted,
not_interested/opt-out → suppress) + user-added automations, renamed HOUSEKEEPING RULES,
**collapsed by default**. "How replies are read" also collapses (header shows count).
Progressive disclosure is the pattern: fewer visible toggles, everything one click away.

### 7.2 Branch cards open their sequence
"Edit ›" expands the card in place: the rule sentence, the branch's step list (channel ·
wait · edit affordance), + Add step. Note shown: edits apply to contacts entering after
the change (engine: graph node edit semantics).

### 7.3 Tab order
Overview · Inbox · Pipeline · Plan · Stats (Plan demoted, Inbox promoted to slot 2).

### 7.4 Campaign inbox — full pass
- **TYPE filter row** (channel: Email / SMS / Calls / WhatsApp-disabled-honest) alongside
  the intent chips; both filters compose.
- **Typed thread canvas** (same vocabulary as workspace inbox): email = subject-headed
  card; SMS = bubbles; voice = call card with outcome chip, waveform + recording,
  pull-quote, ✓ summary lines, transcript link + credits.
- **Composer**: Ada's draft as a card (✦ header · "nothing sends without you" · Edit
  toggles inline textarea · ↻ regenerate · Approve & send states the send identity) +
  ALWAYS a manual reply field ("sends as you"). Sending appends to the thread and retires
  the draft. Voice threads: manual replies go by SMS (stated in placeholder).
- **Move ▾** menu: mark intent / move to re-engagement / remove from campaign — writes the
  thread's status chip live. **✓ Done** sets Done state.
- **Contact mini-profile**: click the identity → inline card (EMAIL/PHONE/SOURCE/STATUS +
  "Open full contact ›" honestly noted as landing with the Contacts build).
- Threads with waiting drafts show a ✦ draft marker in the list.

### 7.5 Workspace inbox — same finesse + motion
- **Ada summary strip** on top: breathing gradient mark + two rotating context lines (CSS
  cfTickA/B, 9s loop) + honest counts. Engine: same summary composer as Ada's read (§6.2),
  workspace-scoped.
- Channel filter chips (incl. Chatbot); campaign-tie chip stays on threads/header.
- Header + composer + mini-profile + Move ▾/Done identical to the campaign inbox pattern
  (one interaction vocabulary, two scopes). Draft ✦ markers on thread rows.
- Engine note: replies/sends here ride the same send pipeline + receipts; manual sends log
  as user-authored (no ✦).

### 7.7 Workspace inbox structure (owner: "think it structurally")
- **Campaign scope dropdown** above the grid ("All campaigns ▾" → each campaign · Direct):
  the inbox is workspace-wide by definition (workspace switching stays in the rail
  switcher); the useful scope here is per-campaign. Scoped view drops the group headers;
  an over-filtered empty result shows a quiet ✓ state, never a dead grid.
- **Threads group by campaign** (◇ group headers: Implant open day / Q3 reactivation /
  New-patient welcome / Direct) — structural context replaces the per-row tie chips the
  de-noise removed. One signal per row holds.
- **Open thread header carries the context line**: company · ◇ campaign · enrollment
  state (step / sequence complete / captured-consented).
- Engine: inbox threads query gains campaign-scope param + campaign grouping.

### 7.8 Contacts surface — full build (owner: "rich, with soul")
- **Custom surface** (replaces the generic narrated list): lists sidebar (All + 4 lists +
  user-created) · searchable table (photo, name/email, phone mono, stage chip — the one
  signal, list count, campaign · step, last activity; suppressed rows dim) · stage chips +
  search compose with list selection.
- **Circular photo avatars** (hotlinked randomuser.me stock portraits in the mock — swap
  for a real asset pipeline at build; gradient-initial fallback stays the engine default).
- **Contact detail page** (row click, ‹ back): hero (photo, name, stage, phone · email ·
  consent), working **Add to list ▾** (toggles membership live), **Message ›** (jumps to
  Inbox), info card (source/since/ICP), lists card (+ add), campaigns card (per-campaign
  enrollment state + Enroll affordance), activity timeline (receipted agent actions incl.
  Receptionist bookings) with ✦ provenance footer.
- **＋ New list creates directly** — no Ada round-trip — and Ada acknowledges it
  ("✦ Ada noticed — say the word and she'll fill it"). **Routing ruling (proposed, owner
  to confirm): structural CRUD (lists, renames, imports) is direct UI; anything that
  sends or changes live campaign behaviour routes through Ada; every direct edit emits
  its event so Ada's picture stays true.**
- **Ada card chips act now**: "See the 41 ›" filters the table to ICP matches; "Merge 12
  duplicates ✦" runs and flips to ✓. Engine: list CRUD + membership endpoints; contact
  timeline = the receipts feed scoped to one contact; duplicate detection job.
- **v4 drawer parity port (owner-flagged)**: hero gains tag chips + Opens/Replies/Score
  stats; action row = ✉ Message (primary) · ☎ Call (queues, flips to ✓, logs a timeline
  receipt) · ↪ Move ▾ (stage, live) · ⏸ Pause in campaign (campaigns card reflects it) ·
  ✎ Note (logs team-only note) · ⌗ Tag. DETAILS card leads with the List row + the
  BINDING add-to-list menu anatomy (header · icon+count rows · ✓ current · ＋ New list
  footer that creates AND assigns — per PLAN_CONTACT_LISTS unification rule, one menu
  mounted everywhere). CUSTOM FIELDS card with click-to-edit inline values (FR-CON-05).
  Activity timeline gains v4 connector-line anatomy.
- **Relationship is a primary per-list toggle** (Customers · Prospects · Mixed) on the
  contacts toolbar whenever a list is scoped — the §1.1 audience-relationship attribute,
  now settable where lists live, not only at CSV import. Tooltip states its effect
  honestly (warm-reference vs cold-open vs per-contact detection — opener only, per the
  owner ruling). The contact detail DETAILS card shows the inherited value
  ("relationship · Customers — sets the opener (from list)"). Engine wiring: list
  relationship feeds the arc's opener role exactly as §1.1 defined; the toggle writes the
  same stored attribute the CSV-import question sets.
- **All-contacts relationship FILTER**: the same band on "All contacts" becomes
  "Show · Everyone / Customers / Prospects / Mixed" — aggregating by each contact's list
  relationship (filter on All, setter on a scoped list; one control, two modes). Sidebar
  list rows carry "count · relationship" so the attribute is visible without scoping.
- Every mock contact now carries full detail data (company, opens/replies/score, tags,
  custom fields); avatars gained an initials fallback layer under the photo (hotlink
  flakiness never leaves an empty circle).
- **Entity-aware header (canon §8a.10, owner directive "dynamic toolbar")**: opening a
  contact retargets the narrated header — identity line "Dr. Marcus Alvarez · Interested",
  Ada's narration composed from that contact's live state per stage (Interested: opens/
  replies + waiting draft; Question: drafted answer in Needs you; Booked: nothing needs
  you; New: enroll or fold into next suggestion; Not interested: suppression promise),
  chips become entity actions (✦ Review the draft / Open thread / ＋ Enroll). Applies to
  every future subpage as entities open. Engine: §6.2 summary composer with an entity
  scope param.
- Note/Tag popovers (prior pass) confirmed: placeholder guidance, team-only disclosure,
  typed values land in tags/timeline. Move dropdown clip resolved with hero overflow
  removal.
- Hero-collapse fix: the detail page lives in a scrollable flex column — the hero card
  (overflow:hidden) was flex-shrunk to 2px by the tall grid below it. All direct children
  of scrollable flex columns must carry flex:none (added to canon-adjacent lore here).
  Avatars now render as element holes (no url() in style strings, no literal src fetch),
  with monogram fallback beneath.
- Avatar fix: photo holes moved out of literal img/src and colon-bearing style
  declarations — static circle shell + whole-value style hole for the image fill (older
  runtime paints raw markup during stream; literal holes in src fetch as URLs).

### 7.6 De-noise pass (owner escalation) — canon §8a
Owner ruling: the UI had too many labels — every datum was a bordered chip. Binding rules
now live in CONSOLE_V3_CANON §8a (one signal per row · category = accent bar/dot, word only
in the open item · channel = bare glyph, icon-square filters on one row · mono-caps only in
editors/settings · global truths once · >2 actions → ⋯ menu · rail status = dot). Applied
across: both inboxes (rows, filters, headers, composers, meta lines), overview (Ada's read
strategy/next lines de-chipped, activity kind pills dropped — icon carries kind), status
band ("Ada is working" removed; suggested = bare ✦), rail (pills → dots), plan step cards
(mode chip removed — the guided banner carries it), branch cards (✦ AI chip removed).

---

## 8 · Dock surfaces batch (2026-08-12): Forms · Chatbot · Proposals · Analytics

### 8.1 Creation routing — canon §8b
Create = Ada-guided sheet (template cards ★-recommended by business category → spec step →
draft built, "nothing goes live without you"); manage = direct UI. One sheet component,
three docks (form fields checklist · bot behaviors + host page · proposal's 3 questions:
who / offering / price anchor). Built drafts append to the surface and open via "View it ›".
Engine: template registry per category; create endpoints emit the same events Ada-created
artifacts already emit (awareness parity with §7.8 CRUD ruling).

### 8.2 Forms
Card grid replaces rows: each card is a mini render of the actual form (real field labels,
accent CTA) + LIVE/DRAFT pill, hosted URL, subs + conversion, ◇ campaign tie. Detail =
hosted-page preview (browser chrome + full field render) beside working editor cards:
fields (required toggle · remove · add chips), share (copy link flips ✓ · live/draft
toggle with honest copy), routing (submission → contact + enroll + suppression note),
recent submissions. Engine: forms CRUD + field schema, hosted URLs, submission → contact
pipeline events, per-form conversion stat.

### 8.3 Chatbot
Bot cards (greet bubble preview, LIVE/DRAFT, chats · booked · captured) → detail = the
existing site-preview surface, now parameterized (site label, greeting, stats) with a
BEHAVIOR card (greeting · captures · books · handoff · 🔒 AI disclosure) replacing the
redundant deployments list. Engine: per-deployment config + stats rollup.

### 8.4 Proposals (old-proto port, v3 skin)
Cover-first grid: real cover art (brand gradients + the old proto's photo covers), status
pill on-cover, ✦ Ada-drafted glyph, value + freshness. Detail = client-view document
(cover · summary · scope ✓ · investment table + total band · Accept & sign mock) with a
status-timeline rail + actions (copy client link, ✦ nudge for Viewed/Sent — flips queued,
Send for drafts). Honest note: full section editor lands with the Proposals build unit.
Engine: proposal object w/ sections + pricing, hosted client link, open/view/sign events
(feeds the timeline + stalled detection), nudge action in R1 vocabulary (send_payment_link
precedent).

### 8.5 Analytics
Numbers-first left column (4 stat tiles · channel table with bars · TEAM table: Ada ✦ /
Jordan / Sam attribution with honest footnote) + right "Ada reads it" narration card that
recomposes from the live filter state. Filters: time (7/30/90d) × campaign × team member —
all compose; Advanced › swaps in deliverability (delivered/bounce/spam/warm-up) +
conversions (forms, chatbot, proposals, revenue) with last-touch note. Engine: metrics
API with time/campaign/member dimensions; narration = §6.2 composer over the filtered
aggregates; NEW model requirement — workspace members with attribution on manual
sends/approvals (Ada's actions attribute to Ada, never to a human).

### 8.6 Entity-aware headers (canon §8a.10 applied)
Opening a form/bot/proposal retargets the narrated header with per-entity narration +
entity chips (Copy link · ✦ Nudge it). Contacts pattern extended verbatim.

### 8.7 Owner escalation rework (same day) — create-in-panel + entity anatomy
- **Create sheet RETIRED.** Creation renders inside the existing Ada pop-up (canon §8b
  amended): ask bubble ("Build me a form") → intro → template cards → spec → draft.
  Launch points: surface ✦ button + Ada-card chips; ✕/Done restores normal Ada state.
- **Entity anatomy (canon §8c)** applied to all three details — back row · stat strip ·
  segment tabs:
  · Forms: stats (submissions/conversion/last/routes-to ◇) + Form (preview+fields only) /
    Responses (read-only rows, per-row expand to full field values, Open contact ›,
    Export CSV) / Settings (live toggle · campaign+list routing · share+embed · archive).
  · Chatbot: stats (chats/booked/captured/handoff) + Preview (full-bleed site preview) /
    Conversations (outcome-chipped rows expanding to transcripts; Captured rows cross-nav
    to Inbox) / Setup (live toggle · behavior · routing · embed). Bot cards simplified.
  · Proposals: stats (value/views/sent-to/expiry) + folder chips w/ counts on the list,
    views meta on cards; Document / Activity (engagement log + ✦ read) / Settings
    (recipient·expiry·tracking·sign·cover + void) — persistent status/actions rail.
- Engine deltas: form responses store per-field values (read-only view + CSV export);
  chatbot conversation log with outcome classification + transcript retention (same
  consent flag as voice); proposal engagement events (open/section-view/sign) per
  recipient.

### 8.8 Depth-parity corrections (owner, same day)
- **Forms cards compacted** to the chatbot-card pattern (tile · name · url · LIVE ·
  subs/convert/fields row) — the mini-preview card was too big; the real preview lives in
  the detail's Form tab.
- **Forms design settings** (old-proto sw()/submitButtonText parity): accent swatches +
  button-text input in the Form tab's design card; both feed the live preview and the
  cards (fAccX/fCtaX).
- **Chatbot preview is now interactive**: quick-reply chips walk a real scripted flow
  (Book a visit → slot pick → booked ✓ · Call me back · Get an estimate · ↺ Start over),
  and a Setup › appearance card (accent swatches, widget position left/right, greeting
  input) restyles the preview instantly — user bubbles, chips and send button take the
  accent; the widget moves corners. Engine: widget config = {accent, position, greeting}
  in the deployment record.
- **Proposals depth (old-proto parity)**: new ✎ Edit tab — cover picker (4 brand
  gradients + 2 photos), overlay dark/soft, brand-line toggle, title + summary inputs,
  insert blocks (Timeline · Stats) — ALL applying live to the Document tab and the list
  card. Send flow on drafts: Send it › → recipient + subject review → Send: status flips
  Sent everywhere (pill, folders, stats, activity gains the event, rail shows tracking
  note). Engine: proposal doc model gains cover/overlay/logo fields + block array; send
  endpoint (email + SMS link) with expiry + tracked opens.

### 8.9 Old-prototype parity audit + in-place editor (owner escalation №2)
Audit sources: Forms.dc.html · Proposals.dc.html · Analytics.dc.html · components/Widget/*.vue (shipped widget tabs).

**Proposals — the Document IS the editor now (old-proto model).** ✎ Edit tab retired;
Document tab carries a View / ✎ Edit mode seg. Edit mode: title (on-cover input),
summary, every scope line (edit · ✕ · ＋), every pricing row (item + amount · ✕ · ＋ ·
editable Total), Timeline rows, Stats tiles — all editable IN PLACE; blocks carry
"remove ✕"; a slim cover strip (6 covers · overlay · brand-line toggle · block adders)
sits above the document. **Video block** (old proto's YouTube/Vimeo/Loom embed): player
placeholder + URL input, offered at create time ("Include an intro video"). View mode +
list cards + client view reflect every override. Deferred from old proto with reasons:
contenteditable rich-text runs + drag-reorder + {{Variables}} → Proposals build unit
(engine-level; mock uses structured in-place editing); folders → status chips (§8.7).

**Forms — after-submit behavior (old proto "Advanced options").** Settings gains:
redirect URL (or) success heading + message with live success-card preview, honest
"After submit →" state line, and the old proto's double opt-in toggle (consent-relevant
for SMS). Old proto's bg/button color system → v3 accent + button text (§8.8) — full
palette deferred to build unit, noted.

**Chatbot — widget-kit tab parity.** Setup gains capture FIELDS as editable chips
(add/remove — Email, Insurance, Preferred time…), HOURS (24/7 vs business hours with
honest after-hours behavior line), INSTALL state on the embed card (✓ installed · last
seen / ○ not installed). Widget kit's Design tab ≙ appearance card (§8.8);
Conversations tab ≙ §8.7; Scheduling/Fields/InstallVerify now covered.

**Analytics** — old tabs map complete: channels/agents(=team)/deliverability/
conversions/revenue(=attributed row). No gap found.

Engine deltas: proposal doc model = ordered block array with per-block payloads (incl.
video URL); form config gains redirectUrl/successHeading/successText/doubleOptIn;
widget config gains fields[]/hours; install heartbeat (last-seen) per deployment.

### 8.10 Focus layout + owner fixes (canon §8d)
- v3.2 (owner: "it's slowly getting bigger, the other going out"): TRUE zoom. While
  the rail is open the campaign holds at scale .94; the transition continuously grows
  it .94 → 1 (1.7s, .3s after the rail's 1s in-place fade begins) — visible enlargement,
  no arc trickery; reopening shrinks it back as the rail fades in. Hold ~6s protected;
  push remains dock-only. Engine: UI state only.
- Forms: unread-response badges (card pill · Responses-tab counter, cleared on visit),
  per-submission notify toggle in the responses header, and a field TYPE menu
  (text/email/phone/date/select/long text) on every field row.
- Chatbot: Setup & preview are ONE tab — settings column beside the live widget preview,
  every change visible as you make it (owner ruling: never separate preview from setup).

### 8.11 Automations · Integrations · Lead finder surfaces (2026-08-12)
- **Automations**: rows carry the WHEN sentence + ◇ scope + live fired count + a working
  pause toggle; ✦ suggested rules (R1 vocabulary, Add flips live). Detail = §8c anatomy —
  stats (fired/last/clean-rate/scope) + Rule (WHEN/THEN cards · pause with honest reason ·
  ▶ test-run that simulates without sending) / Runs (receipted log, cross-noted to contact
  timeline + Agent activity) / Settings (scope · 2-hop chain limit 🔒 · pause-on-error ·
  origin ✦ · delete keeps receipts).
- **Integrations**: cards state what each connection DOES for the agent + which features
  use it; Connect flips live (sandbox note at build). Detail: status stats, used-by ↔
  permissions (full list, honestly), activity log, disconnect with honest downstream
  pause. BuyerPing added as first-class integration.
- **Lead finder — no keywords**: an Ada command bar ("describe who you want") + intent
  chips; a "how Ada searched" receipt line (ICP × sources × intent · dedupe count) makes
  the intelligence visible. Results are WHY-first rows (each reason cites its source),
  match %, expandable evidence + ✦ opener angle, per-row Add (creates contact with
  evidence attached) and a Load-top-40 batch. **BuyerPing intent**: dark by default with
  an honest connect strip; connecting lights the 🔥 Surging/Warm column and intent-sourced
  evidence rows (also flips the integration in Integrations).
- Engine: NL→search compiler (Ada translates intent to provider queries + agent re-rank),
  per-row "why" receipts with source attribution, intent-signal ingestion via BuyerPing,
  dedupe against contacts, evidence stored on created contacts. Entity headers extended
  to automation/integration details (§8a.10).
- **Punchlist (parked, owner)**: picking another campaign while already in zoom mode
  re-plays the focus choreography — should switch without re-triggering (or a much
  shorter settle). Handle with the layout-polish pass.

### 8.12 Completeness pass + Ada interaction map (owner: "every single action")
**Grounding (repo, INT W1–W5 / DEC-093..095):** provider registry = slack · gcal ·
calendly · stripe · webhooks · hubspot · zapier; statuses connected/unhealthy/revoked;
Slack kinds new_reply · meeting_booked · goal_completed; actions send_webhook (signed,
SSRF-guarded, IntegrationDelivery ledger, failure never flips run outcome) +
send_payment_link (DEC-095); events calendar.rescheduled/canceled.v1 (DEC-094) ·
payment.received.v1. Surface rebuilt on that registry (Sheets dropped — Zapier covers
it; BuyerPing marked NEW, ships with the Lead finder unit).

**Integrations — every path now works:** connect (card → detail with the FULL permission
list before the grant) · test event (fires through the real delivery path into the
ledger) · unhealthy → Reconnect (Stripe example: rotated webhook secret pauses
payment.received honestly, payment links keep working) · disconnect (features pause
honestly) · per-provider engine-truth line · wave tags.

**Automations — every path:** suggested Add now CREATES the rule in the list (with the
engine event name); Ada plan Approve creates + lands you on Automations; runs show the
error path (Slack timeout → retried ✓, outcome unaffected) + empty state; Edit routes
through Ada (§8b: behavior changes are generative); Delete works, receipts stay.

**Lead finder — every action:** Find them actually runs (searching state → plan line
rewrites around YOUR ask with match counts); ICP ✎ opens the business ICP; Watch this
search (Ada re-runs weekly → Suggested); per-row Add / batch Add-all (rows flip ✓);
expand → evidence + ✦ Draft the outreach (Ada, seeded with the angle) + Not a fit ✕
(removes AND teaches the match profile); BuyerPing dark/lit is ONE state with
Integrations.

**Ada interaction map (all three surfaces):**
1. CREATE — "Ask Ada to automate" / plan chips → Ada plan card (WHEN/THEN) → Approve
   creates the live rule. Forms/bots/proposals use the in-panel create flow (§8b).
2. EDIT — behavior changes (rule wording, targeting) seed Ada with the object named:
   "Change this rule: …". Structural toggles (pause, connect, add field) stay direct.
3. RUN — Lead finder's bar is an Ada command: NL ask → compiled search → receipted plan
   line; "Draft the outreach" seeds Ada with the per-lead angle.
4. EXPLAIN — narrated headers answer "why" (paused reason, unhealthy reason, why-matched)
   and their chips open Ada with the question pre-asked ("Why is one paused?").
5. WATCH — standing intents (watched searches, suggested rules/campaigns) are Ada's
   background loop surfacing back into ✦ Suggested.

### 8.13 Workspace Settings surface (owner: "full settings page, nothing missing")
TWO SCOPES, TWO PAGES (owner correction ×2 — final architecture, matches old protos):
- "⚙ Workspace settings" (switcher item) → in-console surface, workspace scope only:
  Workspace · Senders & numbers · Team & roles · Custom fields · Guardrails &
  compliance · Notifications & data. Direct-edit; no Ada hint bar. Bold icon nav +
  rich drill-in details (sender detail: health/stats/warm-up/DNS/limits/pause·
  number detail: A2P, usage, channels, Receptionist link).
- "Account home · plan & billing" (switcher item) → **navigates to
  `Clientforce Account.dc.html` — a SEPARATE page sharing nothing with the console**
  (port of Account Admin.dc.html, restyled to the refresh brand): light-panel sidebar
  (Workspaces · Reseller · Agency · Branding · Agency Earnings + Plans & billing ·
  Help & training), workspace cards whose "Open →" launches the console file (agent +
  tools), manage drawer, 4-step new-workspace wizard, reseller sub-account
  table/create/edit/success/assets, agency site hub + 3-step website wizard,
  white-label branding w/ swatches, earnings tables, Agency $297/mo plan card
  (LEGACY-PROTO PRICE — owner reprices), invoices, help & training w/ video player +
  library. **Agency is the main menu & hub** (owner directive): nav = Agency ·
  Sub-accounts · Branding · Earnings · Plans · Help (separate Workspaces item retired —
  workspaces live inside Agency). Agency is two-state: first visit → "Set up your
  agency" chooser — (a) existing agency: profile form (name*, URL*, email, phone,
  IG/FB/LinkedIn) → agency home; (b) new agency: bold 3-step wizard (01 Name &
  SERVICES — the Clientforce agency comes fully set up to sell outcomes; you pick 2–3
  services to lead with (outbound campaigns · AI receptionist · reactivation · AI chat ·
  reviews · websites) + contact info; NICHE IS NEVER ASKED HERE · 02 Template or
  describe-with-AI · 03 BIG browser preview with live colorway swatches, subdomain,
  optional custom domain, optional Stripe connect) → launch → agency home. Wizard
  extras (owner adds): step 02 also picks the WEBSITE VERSION — 4 real variants of the
  DFY site (Forward / Centered / Split / Bold), each with a Preview ↗ that opens
  `Clientforce Agency Website.dc.html#v=<variant>` (the site reads the hash + a
  `variant` tweak; variants are real hero/composition changes, not thumbnails) — and a
  LOGO choice: ✦ AI-designed mark (default, previewed in brand color) or upload-my-own
  (mock upload); the existing-agency form gets a plain logo upload row. w3 preview page
  is redesigned: tall sticky browser frame LEFT (620px, variant tag in the chrome),
  version pills + "Preview full site ↗" under it, controls stacked RIGHT (colorway,
  summary incl. Version/Logo rows, subdomain/custom domain, Stripe, launch). Launch
  stores variant+logo on the profile; the agency-home URL chip opens the live site
  with the saved variant. Niche
  chips appear ONLY in the freeform new-WEBSITE wizard (site mode: niche incl. Any
  business + goal). **Setup step 02 is a DESIGN step, not templates** (owner
  correction): the DFY agency site is one canonical build — you choose color scheme
  (4 palettes), typeface (3 pairings), style tone, and tick "Add a lead magnet"
  (Missed-Call Money Report funnel). Templates appear only in site mode. **The full
  DFY agency website exists as its own artifact: `Clientforce Agency Website.dc.html`**
  — 5 sub-pages (Home / Services / Results / About / Book a call) with hero + stats,
  6 outcome-priced services (cards + detailed blocks with included-lists), 3 case
  studies with numbers + quotes, how-it-works, testimonials, 5-question FAQ
  accordion, 60-day guarantee band, lead-magnet banner + email-capture modal, full
  booking page (day/slot picker + form → confirmed state), AI-disclosure line and
  "Powered by Clientforce" footer. Tweaks: palette / agencyName / leadMagnet. Wizard
  w3 links to it ("Browse the full site"); a built agency's home-hero URL opens it.
  Agency home = identity hero (avatar, name, URL, services line,
  socials, Stripe chip, ✎ Edit, Workspaces/Sub-accounts/MRR strip) + pill tabs:
  **Workspaces** (default — full old workspaces surface: stats, search, filters,
  cards, wizard, drawer) | **Websites** (condensed rows: thumb · title · domain · kind
  · status · Edit/Domain/✕ + inline New website). "Reseller" is retired wording → **Sub-accounts** everywhere; creation is a 4-step flow (Client → Plan
  $89/$129 → Access [invite link default / set password] + workspace start [blank/clone]
  → Review); Earnings is one merged view (stats incl. next payout, by-client table,
  payments). Workspace seeds: Bright Smile Dental · Northwind Agency · Vela Studio
  (+ Lakeside Trial, Cedar Suspended) — coherent with the console switcher.
Console-side §8c settings anatomy: section nav + one section visible. Parity audit vs
old Settings.dc.html + Account Admin.dc.html — everything carried, rearrangement only:
- WORKSPACE: name/timezone/logo (logo reused by forms · proposals · widget) + brand
  links & docs (agent-citable assets; old proto's brandLinks/brandDocs). Brain/ICP/
  training pointer → Business profile (not duplicated — §8a one-home rule).
- SENDERS & NUMBERS (old proto's deepest system, fully carried): 3 sender rows —
  Google OAuth (health 98) · M365 warming (day 18/45, rising limit) · Clientforce
  Mailer (dedicated IP) — expanding to warm-up, SPF/DKIM/DMARC chips, role, reconnect;
  ＋ Add sender. Voice/SMS number with A2P brand+campaign ✓ status; WhatsApp honest
  (US marketing paused; replies/utility fine); credit rates cross-noted.
- TEAM & ROLES: Jordan Owner · Sam Member · Ada ✦ agent row (always disclosed,
  receipted); working invite flow (email + Member/Admin → sent confirmation); role
  meanings + honest attribution note.
- PLAN & BILLING: Growth $199 · live credit meter (1,240/5,000, resets Sep 1) ·
  add-ons (Receptionist ✓ · BuyerPing pending unit) · Visa ··4242 + invoices · working
  top-up (3 packs → queued-to-invoice confirmation) with blended-rate honesty line.
- CUSTOM FIELDS: registry (label · type · slug — old proto's cfList + the console's
  two) + working add (label + 5 types, slug auto).
- GUARDRAILS & COMPLIANCE: do/don't list (old proto's gItems; working add with
  DO/DON'T kind) · quiet-hours + daily-cap toggles · 🔒 unswitchable platform promises
  row · suppression-list count.
- SECURITY & DATA: 2FA, sessions, Slack notification kinds (registry truth), morning
  digest, export (CSV+JSON incl. receipts/transcripts), 24-mo retention, owner-only
  delete with grace + final export.
Deferred honestly: per-sender ISP reputation/blacklist panels + SMTP/IMAP field editors
(old proto) → senders build unit; noted here so nothing is lost.

---

## 8.15 · Client access & reporting (owner ruling, 2026-08-12) — NEW

**The line: managed client → portal; sub-account client → platform.**

**Client portal** (`Clientforce Client Portal.dc.html`, white-labeled — agency name/
accent/powered-by are props): magic-link entry (no password), outcome numbers only
(booked / replies / revenue attributed / show rate), agency-voiced AI read with
provenance ("written by agency's AI · reviewed by <human>"), **approvals as the one
interactive verb** (offer/rule-change cards with the actual copy shown; Approve ✓ or
Request changes → prefilled comment), monthly report reader (summary → what we ran →
next month, archive), booked-appointments list (✦ = AI-booked), plain-language
"running for you now", and a comments thread (client ↔ agency). Footer states the
contract: view + comment only. NEVER shown: credits, costs, campaign mechanics,
automations, sender health, other clients.

**Sub-accounts & billing method** (account page): White-label kit lives ONLY under
Selling tools — the agency sells; sub-accounts don't get assets. Sub-accounts list
opens with a workspace-vs-sub-account explainer (workspace = a business you run inside
your account; sub-account = a separate login you resell — you set price, Clientforce
bills you wholesale) beside an allotment meter: Agency plan includes 20 (used/20 bar;
more from Plan & billing). Earnings leads with a gradient-edged Stripe banner —
disconnected: "Connect Stripe" primary + "Bill manually instead" secondary (manual
mode = standing amber notice: you invoice, wholesale still billed, payment status
self-recorded, not Stripe-verified); connected: green receipt chip + Manage. Sub-account
create step 2 references billing (amber "can't auto-bill yet" with Connect / manual vs
green "billed through your Stripe from invite accept"); Review gains a Billing row.

**Agency Reports view** (account page › Client reports): per-client rows — cadence ·
approvals mode (🔒 Required / Advisory) · last report + opened chip · pending count ·
Review/Portal actions. Drawer per client: AI-drafted report preview, cadence pills
(draft-then-send schedule stated), approvals-mode radios, "Approve & send now"
(updates row, open tracking resets). Stats: sent / opened / pending approvals /
drafts to review.

**One engine, two doors:** reports are GENERATED in the workspace (numbers, honesty
rules, Ada narration live there); the agency level owns cadence, branding, review
and oversight. Client comments/approvals land in that workspace's inbox — never
managed in two places.

**Engine work this implies:**
1. Portal auth: magic-link tokens per contact-at-client, 7-day expiry, revocable;
   scoped read model (outcomes + reports + own appointments only).
2. Report engine: per-workspace composer (Ada draft from analytics) + agency-level
   schedule/branding/review queue + send + open tracking.
3. Approval objects: offer/rule-change items with state machine (pending → approved /
   changes-requested), **per-workspace blocking flag** (required = send waits; advisory
   = sends unless objection); events → workspace Needs-you.
4. Portal comments → workspace inbox thread type (BUILT in console: 'Portal' thread —
   ▤ badge, client notes + approval receipts as thread items, reply lands back in the
   portal); agency replies mirror back. Agency links open the portal in a labeled
   AGENCY PREVIEW mode (#preview: banner, client verbs guarded, back-to-account) —
   the bare link stays the client's magic-link view.
5. White-label pass-through: branding section's logo/accent/hide-powered-by feed the
   portal + report emails.
6. Deferred to build unit: in-console report composer UI (drawer preview is the
   review door for now); portal appointment self-reschedule; comment attachments.


---

## 9 · CONSOLE X — ground-up exploration (owner mandate, Aug 12)

Owner: discard ALL existing branding/colors/fonts for a from-scratch rethink —
futuristic, high-intelligence, fluid; logo experimentation allowed. Built as a separate
file (`Clientforce Console X.dc.html`); the shipped console + "Quiet confidence" canon
are UNTOUCHED — this is an exploration, not a re-skin. Interaction model carries over
(goal-first campaigns, Needs you, receipts, focus zoom); the skin is new.

**Direction — "Solar Console"** (RNG-seeded, then committed):
- Canvas: graphite #0A0C10 + faint 56px grid + amber radial atmosphere
- ONE accent: solar #FFB13D (beams #FFD34D→#FF8A3D); green/red only as status dots
- Glass panels #101318 · borders rgba(255,255,255,.07) · glows ALLOWED (old no-shadow
  rule belongs to the old system)
- Type: Geist (display+UI) · Azeret Mono (all numbers/receipts/labels)
- Logo experiment: rotated-square "signal" mark + CONSOLE X letterspaced tag
- Motion: one ease cubic-bezier(.16,1,.3,1); staggered load; goal-beam sweep; shimmer
  composing line; orb pulse; focus zoom kept click-only (« in rail header)

**Anatomy**: left rail = campaign signal cards (live dot, animated sparkline, conic
goal ring, booked/target mono) + workspace footer w/ credits · center = gradient-ink
campaign title, GOAL BEAM (booked count inside the fill, pace + target inline), glass
segmented tabs w/ glow underline · Overview = metrics quartet + Ada live feed (streams
new receipts every ~5s, shimmer "composing" line, rows deep-link to tabs) + Needs you
(approve/skip work) + Next moves (queue works) · Inbox = pills + threads + reading pane
w/ ✦ draft approve/edit + live composer · Pipeline = 4-stage board, NUDGE/OPEN actions ·
Plan = beam timeline + branches + guardrails (locked row + working toggles) · Stats =
7-day bars (today glows) + channel mix + credits meter · right dock = Pulse/Inbox/
Contacts/Automations/Analytics/Settings glass icons — each a real compact surface
(automations toggles fire, contacts segments show live use) · Ada bar = pulsing orb,
ask → grounded answer panel w/ receipt chips + one-click "queue as proposed change";
keyword answers for saturday/recall/credits, workspace default otherwise.

All actions functional (owner meticulous-implementation rule): approvals remove + toast,
moves queue, toggles flip, drafts send, pipeline advances, dock surfaces populated.


---

## 10 · Console X → green console ports (owner picks, Aug 14)

Owner kept the green system; X survives as exploration only. Ported into
`Clientforce Console.dc.html` (pre-pass archived at archive/Console pre-Apple pass):
1. **Activity is the campaign hero**: card moved ABOVE Needs you; header = pulsing live
   dot + "Ada is working this campaign" + LIVE pill; newest row gets mint gradient +
   #35E834 edge (the X glow, in green); rows carry kind pills (Booked/Reply/Agent
   decision ✦…) and REAL CONTACT PHOTOS (pravatar) when the event ties to a person.
2. **Metrics with commentary**: label row + delta ("+2 today") on top, big mono number +
   sub ("of 12 slots", "19% replied", "3 channels · 188 cr") below; Booked tile wears a
   soft green glow (canon amendment in CLAUDE.md).
3. **Pipeline board**: photo/gradient avatars, wider cols, and X's action labels —
   NUDGE › (Contacted/Engaged → ✓ QUEUED on click) and OPEN › (Interested → jumps to
   Inbox); +8 seeded contacts so stages read full.
4. **Plan = left-line timeline** (X pattern): one card, gradient spine, circular channel
   nodes, one-line title+brief rows with STEP n / channel / Open ›, delay dots as
   "⏱ wait 2 days ✎" chips on the spine; click → existing step-detail; Add step aligned
   to the spine. Branches & rules view untouched.
5. **Stats + credits**: full-width Credits strip (188 of 600 · $0.56 · 31% bar ·
   "voice is the biggest line") between tiles and channel grids.
6. **Ada bar is context-aware**: chips derive from surface — campaign tabs
   (overview: Why is this working? / budget; pipeline: who's gone quiet; steps: add a
   voice step…) and every dock surface (Contacts: build overdue-recall list; Lead
   finder: find candidates near 78704 + buyer-intent; Forms: create a booking form;
   Chatbot/Proposals/Automations/Integrations/Analytics each get their own). ask-chips
   open Ada directly; build-chips seed the composer. Owner will do a per-page pass on
   common-use-case flows later — chips are the first layer.
7. Root wash gains two faint radial lights (Apple atmosphere), hero cards 16px radius.


## 11 · One-sheet pages + neutral surfaces (owner, Aug 14)
Every internal page body (campaign tabs, business core, contacts list/detail, ws inbox,
ws settings, automations, integrations, lead finder, forms list/detail/responses/setup,
chatbot list/preview/convos, proposals gallery/detail, analytics) renders on ONE white
sheet (#fff, 16px radius, hairline) — inner elements are hairline sections, not floating
cards on the wash. Surface palette neutralized (green kept to accents only): wash
#EFF1F0 · panels #FCFCFC · hovers #F6F7F7 · wells #F2F3F3 · hairlines #E9EAEA/#DEE1DF/
#E4E6E5/#EDEFEE/#F1F2F2. Forest/mint accent tokens untouched. CLAUDE.md amended.


## 12 · Old-proto editor parity pass (owner, Aug 14)
Audited Proposals.dc.html / Forms.dc.html / Agent Widget.dc.html and ported the depth:
- **Proposal editor**: cramped inline toolbar retired → right-column SETUP INSPECTOR in
  ✎ Edit mode (Cover grid + overlay + brand line · Details: presenter/role/prepared-for
  w/ merge tags/date/validity · Call to action: Book/Payment/Both, book button + calendar
  link, payment currency/amount/cadence/pay-button + Stripe line · Blocks pills ·
  tracking toggle). Doc hero carries presenter/date; static "Accept & sign" → dynamic
  client CTA panel (editable heading/sub, pay+book+accept buttons driven by CTA config,
  validity + tracking footnote). Status/send column unchanged below (view mode = as-was).
- **Forms builder**: field rows gain contact-mapping chips (contact.email/phone/name or
  custom.*) and a select-options editor (add/edit/remove); type menu, required, add-field,
  design, after-submit (redirect/success/opt-in), routing, share/embed all as before.
- **Chatbot**: preview and setup UNIFIED on one screen — left = live interactive preview
  (fake page, chat window, clickable quick replies w/ scripted answers, launcher, unread
  badge, AI disclosure line), right = setup that reflects instantly (Identity: name/
  greeting/quick replies · Appearance: accent swatches/theme/position/corners/badge ·
  Behaviour: open-after/exit-intent/voice replies/✦ proposal generation · Lead capture
  rows w/ mapping + toggles · Install: embed snippet + copy + publish). Dock creation-
  model brainstorm (agent-only vs hybrid) is OPEN — owner wants it next.


## 13 · Create flows + surface upgrades (owner, Aug 14 late)
- **Automations**: list opens with a two-path create row — "⚙ Build it yourself" opens the
  full hand builder (overlay on the colored container: grouped WHEN triggers
  [contact/time/data incl. BuyerPing surge], ONLY IF condition chips, ordered THEN
  actions add/remove from 9-action menu, name w/ auto-hint, locked-guardrails note,
  live summary line, Save & turn on → lands LIVE in the rules list via auNew).
  "✦ Build with Ada" opens the Ada chat seeded with an automation ask (approve-plan flow
  completes it). NOTE: Ada flows for form/chatbot/proposal exist from the create-flow
  round; owner wants them to cover the ENTIRE build in detail — deepening pass still owed.
- **Proposals**: first view is now ❒ Templates — category pills (All/Plans/Retainers/
  Packages/Promos) + filter toggles (💳 takes payment · ▷ has video), 6 template cards
  (cover, blurb, chips, value) with "Use template" (creates a REAL draft via ppNew,
  opens it) and "✦ with Ada" (seeded Ada draft ask). "Your proposals" is the second tab
  (folders/grid unchanged). Header carries ✦ Draft with Ada.
- **Chatbot**: detail sheets now use the proposal-style colored container (#E8F0EA);
  preview stage carries LIVE presence — pulsing "1 visitor mid-chat · pricing page",
  today chips (14 chats · 5 booked · 82% resolved), glowing launcher.


## 14 · Rail layout everywhere + detailed builder (owner, Aug 14 night)
- **Forms & Chatbot detail = proposal anatomy**: one colored container (forms cyan-tint
  #E8EEF0 · chatbot green #E8F0EA) with a 156px LEFT RAIL — vertical tabs card +
  "At a glance" (forms: live toggle + hosted link/copy; chatbot: chats today · booked ·
  resolved + pulsing "1 visitor mid-chat") — artifact (form preview / widget preview)
  centered from the top, builder/setup as the right column. Inner sheets flattened.
- **Automations create**: the two inline cards are gone — one "＋ New automation" button
  opens a popup: ✦ Build with Ada (gradient edge) / ⚙ Build it yourself.
- **Builder detailed + color-coded** (design-language fix): WHEN is cyan ⚡ (trigger
  groups: CONTACT cyan · TIME amber · DATA teal), picking a trigger opens a CONFIGURE
  row (intent/form/meeting-type/link/lead-time/quiet-window/tag/list/delivery-event
  options); ONLY IF is amber ⧖; THEN is forest → with 13 repo-grounded actions in five
  color-coded families (MESSAGE cyan · FLOW forest · DATA neutral · TEAM amber ·
  CONNECT teal), each added action carrying a clickable blue parameter pill that cycles
  its setting (channel brief, branch, tag, sheet, notify target…). Save composes
  when+config+conds and param'd actions into auNew.


## 15 · Ada interaction model — full brainstorm (proposed to owner, Aug 15)

### The three-lane rule (applies to EVERY surface)
1. **In place**: inspect + light edits are direct manipulation — toggles, params, copy,
   pauses. No Ada in the way. Manual actions EMIT AWARENESS EVENTS (`*.updated.v1` bus
   already exists) so Ada always knows state without owning the click.
2. **Through Ada by default, never Ada-only**: creation + big changes flow through her
   (plan → approve), but every surface keeps ONE manual escape hatch ("Build it
   yourself" — the automations popup is the pattern). Reasons: trust curve, power users,
   degraded-mode honesty, and the repo's typed vocabularies make manual builders cheap.
3. **Ambient, receipted, actionable**: the bottom bar is the ONE entry point everywhere;
   chips are per-surface (built); every answer cites receipts and offers one click —
   "queue as proposed change" → lands in Needs you. Ada never silently mutates.

### Global guarantees
- ✦ provenance on anything she composed; receipts chips on every claim.
- Approval thresholds: money, pricing claims, compliance, bulk sends → always human.
- Proposed-change queue = the single choke point (Needs you), never scattered modals.
- Handoff pill in any thread: Ada owns it until the human types; typing takes over,
  and she says so in-thread.

### Per page (create / edit / ask)
- Campaign Overview — ask: why/budget/what-needs-me; act: approve/skip, queue moves.
  Add later: tap any metric → "explain this number" with receipts.
- Inbox — Ada drafts wait inline; edits teach tone (say so); bulk "draft all questions";
  thread summarize + commitments extract; handoff pill.
- Pipeline — receipts move cards (built); "who's stuck and why"; bulk nudge → approval.
- Plan — briefs not scripts (built); "tighten this sequence" → diff view → approve;
  add-step via Ada drafts the brief.
- Contacts — manual lists/CSV stay manual (owner ruling), Ada gets awareness events;
  plain-English segments ("overdue recalls in 78704") → saved list with count receipt.
- Lead finder — Ada-led by design (no keyword thinking); manual filters appear only as
  refinement chips AFTER results; BuyerPing signals annotate, never auto-enroll.
- Forms / Chatbot / Proposals — three doors: template gallery · ✦ Ada guided (thorough,
  every setting covered, ends in the real editor) · manual editor. Edit always in place.
- Automations — shipped pattern: popup (✦ Ada plan→approve / ⚙ full builder on the
  verbatim rules vocabulary).
- Analytics — narration first (built); any question → receipts; "make this a weekly
  report to my email" → creates the report automation via the same approve flow.
- Settings / Business core — manual is the source of truth agents READ; Ada only flags
  gaps (call_knowledge_gap trigger exists in repo) → "answer 3 questions" micro-flows.
- Workspace inbox / Portal — Ada triages + drafts; portal replies always human-approved.
- Receptionist — presence model stands; Ada surfaces call outcomes to Needs you only.

OPEN with owner: which surfaces (if any) should be Ada-ONLY create; whether the manual
escape hatch is visible everywhere or tucked behind the popup like automations.


## 16 · Ada pass — platform-wide guided builds + Lead finder modes (owner, Aug 15)
One GENERIC guided-build overlay (✦ chat-styled: Ada asks one thing per step, chips/
inputs/toggles, progress dots, review card "everything she'll build", back-nav) drives
FIVE thorough flows, all of which REALLY create:
- **Form** (7 steps): purpose+name → fields multi-pick → required rules + choice-field
  options → accent+button → after-submit (success heading/message, REDIRECT URL, double
  opt-in) → routing (list, campaign, notify) → review → creates fNew (typed fields incl.
  select options, accent, cta, tie) and opens the editor.
- **Chatbot** (6): goal+site → identity (name/greeting/2 quick replies) → looks
  (accent/theme/position) → behaviour (open-4s/exit/voice/✦ proposals) → capture toggles
  → review → creates cbNew + applies the whole config to the live widget (cw) + opens
  preview&setup.
- **Proposal** (6): recipient (known pills or typed) → template → price+cadence → blocks
  (video/timeline/proof) → CTA (book/pay/both + button + calendar) → review → creates
  ppNew + seeds CTA config + opens in Your proposals.
- **CSV import** (4): source+file → column mapping confirm (name/email/phone/company w/
  counts) → relationship (Customers/Prospects/Mixed) + list name → review w/ hygiene line
  (248 rows · 12 merged · 3 suppressed honored) → creates the list (+seed contact),
  selects it in Contacts.
- **Manual contact** (2): essentials + relationship + stage → review w/ awareness note →
  creates the contact (merged into rows + detail) and opens it.
Launch points: ＋ New form / ＋ New chatbot popups (✦ Ada / ⚙ blank — blank also really
creates+opens), ＋ Add contacts popup (CSV / manual / ✦ segment ask), proposals header
"✦ Draft with Ada" + template-card "✦ with Ada" (template preseeded), forms/proposals
entity-header create buttons rewired from the old shallow sheet.
**Lead finder** is two modes now (default ⌖ Direct): Direct = filter rows (industry/
radius/size/signals) + Run search, results score against best customers; ✦ Ada mode =
the ask box + 3-step HOW IT WORKS explainer + "how ada searched" receipt. BuyerPing
DEMOTED: hero card deleted; 🔥 Buyer intent is one optional signal chip (connects
quietly on first tap); intent chips on rows only when on.


## 17 · Ada bar audit — correct on every view (owner, Aug 15)
The bottom bar is now surface-true everywhere: PLACEHOLDER and CHIPS both derive from
one key (dock, or campaign tab, or mode) — campaign tabs each ask their own questions;
every dock surface (Inbox/Contacts/Lead finder/Forms/Chatbot/Proposals/Automations/
Integrations/Analytics) speaks its own verbs; NEW keys added for workspace Settings,
Business core (teach-the-brain), and campaign Create mode (goal suggestion). Entity
headers' ✦ create buttons all route to the thorough guided builds; the footer hint bar
already derives noun/CTA per surface.


## 18 · Apple visual pass (owner, Aug 15)
File-wide re-tune, brand kept: radii one step more generous everywhere (sheets 20,
cards 16–18, controls 10–14 — 648 swaps); hairlines lightened one step so fills and
whitespace carry structure; sheet padding 14; ambient shadow slightly deeper; page
titles (900) up to 28px/-.04em wearing the canon gradient ink; 800-weight section
titles tightened to -.02em. CLAUDE.md amended with the console values.

§16 amendment (owner, Aug 15): guided builds are NOT a modal — they live in the Ada
chat anchor (same bottom-right geometry as the Ada panel, rising off the bar, no
backdrop dim). Same thorough steps; the style ruling was chat, not popup.


## 19 · Color roles + life cues (owner, Aug 15)
"Everything green" fixed with ROLE-based color: forest/mint now mean Ada · live ·
create ONLY; all navigate/inspect links (Open › / View all / Change › / All calls ›
etc.) turned cyan #0E7D93; amber stays needs-you; red danger. Signature-gradient hero
moment added: the Booked metric tile wears the 2.5px gradient edge (canon-legal, one
moment per screen). Cue backlog offered to owner: count-pill hues by channel, hover
lift on cards, sparkline in the goal bar, stage-colored pipeline column headers.


## 20 · Settings flows complete + prominent tabs v3 (owner, Aug 15)
- Tabs (forms/chatbot/proposal rails + all sets): ACTIVE = solid forest, white 800 text,
  soft green glow, 14px labels on tall rows; hued icon chips ride inside (the colored
  toggle) — prominence via size + fill + glow.
- **Add sender** (grounded in senders.controller + BUILD_PLAN): ＋ Add sender → type
  (email/SMS) → email: provider (Google/Microsoft OAuth/SMTP) + address + DNS POSTURE
  rows (SPF/DKIM/DMARC w/ record hints, Verify flips Missing→Found; controller truth
  quoted: "SMS senders have no DNS posture") + warm-up notice (20/day → 500/day over
  45 days) → row lands WARMING in the senders list. SMS: area code → number pick →
  A2P card (brand $4/mo submitted · campaign $10/mo pending 2–3 days · honest texting
  hold, voice immediate) → row lands PENDING A2P.
- **Team roles = the shipped RBAC enum** (DATA_MODEL): OWNER/ADMIN/AGENT/VIEWER cards
  with permission lines in the invite flow.
  *Amended 2026-08-31 (owner, B7.5 approval round): the enum KEYS are unchanged, but the
  word on the card is Owner / Admin / **Member** / Viewer. "Agent" is Ada's role — a human
  labelled Agent collides with her identity and with the campaign-agent vocabulary
  (DEC-107). One source: `WORKSPACE_ROLE_WORD` in `@clientforce/core`.*
- **Company profile ⇄ Workspace settings**: Business core header carries the settings
  sections as tabs (jump straight to senders/team/fields/guardrails/notifications).

§20 amendment (owner, Aug 15): Profile + Settings are ONE home, sane tabs — the profile
page keeps its six tabs plus a single ⚙ Settings tab (mint, right of Train agent) whose
sections swap in place (same sheet family, left-rail sections); Company profile sits
first inside Settings and routes back. No separate settings destination in the user's
mental model; the bottom business card is the one door.

§20 final (owner, Aug 15): TRUE MERGE — the workspace-settings template physically
moved into the profile page as its ⚙ Settings tab (bizPage 'settings'; left SECS rail +
all sections render natively in-page, zero dock switches). Every old route (workspace
switcher ⚙, invite shortcut, cross-tabs) lands on the combined home; the standalone
Settings dock region is an empty gate.

§20 REDESIGN (owner, Aug 15): Business page rebuilt as if profile+settings were born
together — identity HERO (avatar · facts · live health chips: senders healthy / people /
knowledge gaps) over ONE grouped nav: WHAT THE AGENTS KNOW (Profile · Knowledge · Sales
brain · Ideal customer · Train agent) | HOW THE WORKSPACE RUNS (Guardrails · Senders &
numbers · Team & roles · Custom fields · Notifications). Guardrails exists ONCE.
"Workspace" section folded into the hero/Profile. Settings sections render bare in the
content column (transplanted rail and grid stripped); zero dock switches anywhere.


## 21 · Proposed IA — Business (profile + settings as ONE, owner asked for the thinking first)
Principle: the split is never "profile vs settings" (software language). It's
TEACH vs GOVERN (owner language), with shared identity promoted above both.

- L0 · IDENTITY — permanent header, not a tab: name · industry · location · hours
  (+ live health chips: senders / team / knowledge gaps). Shared state: agents read it,
  the workspace derives quiet hours from it. The old "Workspace" section dissolves here.
- L1 · BRAIN (what the agents know): Profile & story · Knowledge · Sales brain ·
  Ideal customer · Train agent.
- L1 · OPERATIONS (how the workspace runs): Channels & senders · Team & roles ·
  Custom fields · Notifications & data.
- L1 · GUARDRAILS — its own pinned entry, belonging to NEITHER group: it's where brain
  meets operations (quiet hours from business hours; caps/compliance govern the agents).
  This is why it kept duplicating — it genuinely belongs to both, so it gets promoted
  once instead of filed twice.
- L2 · section internals (sender detail, invite flow, gap answers) unchanged.
Nav: left rail, two labeled groups + Guardrails pinned (rail = the approved settings
styling; solves "too many tabs"). Entries: bottom business card AND switcher ⚙ both
land here. Billing/plan stays at ACCOUNT level per earlier ruling. AWAITING OWNER GO.


## 22 · Business — built as one (owner GO on §21 IA) + proto-true sender connect
Shell rebuilt: identity HERO (facts + health chips) over a grid — LEFT RAIL in three
groups (WHAT THE AGENTS KNOW: Profile & story / Knowledge / Sales brain / Ideal
customer / Train agent · HOW THE WORKSPACE RUNS: Channels & senders / Team & roles /
Custom fields / Notifications & data · pinned ⛨ GUARDRAILS — one entry, brain-meets-ops).
Settings content renders natively in the content column (ops-gated flags; old Settings
dock gate emptied; switcher ⚙ + invite land inside Business). Workspace section retired
into the hero. SENDER CONNECT now mirrors Settings.dc.html's real model: providers
Google Workspace · Microsoft 365 · Exchange · Custom IMAP/SMTP · Clientforce Mailer;
OAuth providers authorize with the proto's permission list; Custom verifies SMTP AND
IMAP ("replies must flow back in"); Mailer is managed-zero-setup; DNS posture + warm-up
(20→500/day over 45 days) gate the add as before; A2P path unchanged for numbers.


## Dock icon styles — saved variants (2026-08-15)
Dock is reverted to ORIGINAL (per-item tint tiles + stroke line icons). Two explored styles kept for reuse; both pair with the filled logo-mark glyph set (in git history of this file, 2026-08-15) and svg fill rendering (fill="{{i.stroke}}", fill-rule=evenodd, no stroke attrs).

### Style A — unified logo gradient + shine
tileBg on:  linear-gradient(180deg,rgba(255,255,255,.38),transparent 48%), linear-gradient(135deg,#36D7ED,#35E834 55%,#D0F56B)
tileBg off: linear-gradient(180deg,rgba(255,255,255,.72),transparent 52%), linear-gradient(135deg,rgba(54,215,237,.18),rgba(53,232,52,.14) 55%,rgba(208,245,107,.20))
tileBd on rgba(16,22,19,.22) / off rgba(53,232,52,.30) · mark ink #0A0F0C both states

### Style B — alternating logo shades + shine (i % 3)
cyan  { tint rgba(54,215,237,.17), bd rgba(54,215,237,.38), ink #0B6B7E, solid #36D7ED }
green { tint rgba(53,232,52,.14),  bd rgba(53,232,52,.34),  ink #146B33, solid #35E834 }
lime  { tint rgba(208,245,107,.26), bd rgba(176,214,58,.5), ink #5A7015, solid #D0F56B }
shine layer: linear-gradient(180deg,rgba(255,255,255,.7),transparent 52%) · active = solid shade + shine, ink mark


## Focus choreography variants (2026-08-15)
SHARP (LOCKED by owner 2026-08-15): ease cubic-bezier(.32,.72,0,1) · rail opacity .22s/transform .3s · slim .18s d.12s · dock max-h .38s/op .26s · cfRecede .34s · cfApproach .4s
SLOW-PREMIUM (retired): ease cubic-bezier(.33,.02,.1,1) · rail 2.8s/3.2s · slim 1.1s d1.4s · dock 3.8s/2.8s · cfRecede 3.4s · cfApproach 4.2s

Dock active tile: white chat-tail pointer on left edge (rotate 45, radius 3px, hairline L+B, soft shadow).
EXPERIMENT (revert candidate): collapsed rail = ghost-fade into background (opacity .16, blur 3px, saturate .55, scale .96, z0) instead of full hide.


## §12 Credits & billing — two-sided surfaces (2026-08-15)
Model (from economics phase): agency buys credits wholesale, allocates per workspace at a markup; clients never see wholesale.

**Workspace side — Console → Settings → "Plan & billing"** (ops:billing, Owner/Admin per RBAC)
- Plan header: Pro workspace · runs on the agency plan · Active pill.
- Credits: mono balance + burn bar (≈480 cr/day, coverage forecast), working Buy credits (+5,000, balance/bar update), working auto top-up toggle (on = 5k under 2k floor, drawn from agency pool at markup; off = Ada pauses paid sends at zero).
- Rate card chips: Email 1 cr · SMS 2 cr/segment · Voice 15 cr/min · Guided compose ✦ 2 cr · Enrichment 1 cr/contact.
- Client invoices list (rebilled 2.0×, Paid pills, PDF → ✓ Saved). Footer points wholesale/markup to agency console.

**Agency side — Account → Plans & billing** (above Invoice history)
- Credit pool card: 68,400 cr wholesale @ $0.008/cr, MTD usage, auto top-up (10k under 15k), Buy 10,000 — $80.00 (toast), margin line: blended resale $0.0162/cr = 51% credit margin MTD.
- Workspace allocation table: monthly alloc, used bar (%), markup (× or "—" for in-retainer), rebill mode pill (Auto-rebill / In retainer / Manual), Top up action (toast: rebill invoice drafted). Vela row shows the low-balance state (98%, amber bar + "tops up in ~2 days").
- Existing Earnings section (client revenue) untouched — credits margin is separate from retainer revenue.

Backend needs (add to touch map when next synced): credit ledger + balance endpoints, pool top-up (Stripe), per-workspace allocation/markup config, rebill invoice generation, low-balance alerts.


## §13 Credit system — locked decisions + full build (2026-08-15)
Owner-locked (form): top-ups draw from agency pool, rebilled at markup · subs get allocation AND self-serve (global $0.020/cr default, per-sub override — owner skipped, rec applied) · auto top-up default on, per-workspace floor · rebill cadence is a per-client setting · chip visible to all, Top up Owner/Admin only · client portal shows credits only, never dollars · history grain: per channel + per agent + per campaign (no CSV ledger picked).

**Account tiers — one system, flags not forks:** Solo (1 ws): credits attach to the workspace, retail on own card; pool/allocation/markup blocks don't render. Multi-ws business: account pool + allocation, no markup ("Included"). Agency: full model. Workspace UI identical in all three; only the source fine-print changes. One ledger model + account-type flag.

**Shipped this pass**
- Console rail: ink credits strip at the bottom of the business card (breathing green dot, mono balance, white Top up pill) — strip → Plan & billing, Top up → modal. Visible on every dock page; hidden only in focus mode (deliberate chrome-hide).
- Console top-up modal: packs 2,500/5,000/10,000 @ $0.016 rebilled (2.0×), pool line, rebill-cadence note, success state; balance + hero pill update everywhere (wbAmt).
- Account buy modal (Plans & billing): wholesale packs 10k/25k/50k @ $0.008, VISA 4242 row, success updates pool balance {{ crPoolBal }}.
- Allocation rows now drill open: BY CHANNEL (bars) / BY AGENT (Ada · Receptionist · Chatbot) / BY CAMPAIGN + "Full event ledger ›" (toast); Top up stops propagation.
- Sub-account resale card: global rate, resold MTD, 60% margin, Configure ›.
- Sub-account create wizard step 2: Starting credits pills (1,000/2,500/5,000, default 2,500) + resale note; review step shows Credits line.

**Sweep status (all touchpoints now done):** portal report carries a credits-only meter line (no $, per lock); Lead finder header notes enrichment 1 cr/contact; sub-account rows show per-sub balances beside plan.
**Previously:** consumption already surfaces in campaign estimator, stats, activity receipts, workspace hero tile, voice-agent setup. Remaining touchpoints for a later pass: portal credits-only line (portal DC untouched), Lead finder enrichment cost chip, per-sub balances in Sub-accounts manage view.
Backend adds for touch map: account-type flag, pool + per-ws ledgers, markup/rebill config per client, resale rate global+override, Stripe purchase + rebill invoice generation.


## §14 Campaign value model (2026-08-15)
Every campaign goal now carries a money expectation, typed by goal kind: vKind book/react/lead/review, vUnit, vEst $/unit (editable), optional vSalesGoal $ override.
- Overview value strip (above stat tiles): BOOKED/RECOVERED/PIPELINE VALUE · realized $ (booked × est) · math line · goal $ + units · progress bar · editable "$ est/unit" input (per-campaign, live recompute).
- Rail cards: goal line carries the $ goal tag (e.g. "Book 12 Saturday slots · $28.8k").
- Stats: 5th tile "Booked value" ($19.2k · 8 × $2,400 · goal $28.8k).
- Review-type goals stay native-metric (no forced $) — strip hides.
Backend: value fields live on campaign model; est editable per campaign; realized value computed from receipts.


## §15 Ads Closed Loop — add-on (owner: ALL angles in, 2026-08-15)
> **Pricing corrected (owner, same day):** ONE entitlement — $49/mo per workspace covering Meta AND Google; the second provider connects free. Any per-platform price line is retired. Full UI spec (showcase, in-page setup, 8-tab connected view, 90s film, backend tables) now lives in ADDENDUM_3_ADS_LOOP_UI.md, which wins on conflict.
Meta + Google Ads integration shipped as a paid ADD-ON entitlement (like Receptionist). Not data-passback alone — a closed loop: ads feed the agent, the agent's receipts feed the ads.
1. Lead webhooks w/ full ad context (campaign→adset→ad→creative→form answers) → contact timeline; Ada's opener references the ad clicked. (P0)
2. Click-ID capture (gclid/fbclid/UTM) on widget/forms/pages; widget opens mid-pitch on ad context, same offer/price → booking. (P0)
3. Audience engine — first-party syncs per client, auto-maintained from goal state: Booked→exclusion, Interested-no-book→retarget, Won→lookalike seed, suppression→never-target. NO cookie/cross-client selling (ToS + privacy). (P1)
4. Value-based bidding closed loop (THE MOAT): booked/sold/won → Meta CAPI + Google offline conversions WITH v_est dollar value → platforms optimize toward receipted revenue. (P0)
5. Per-ad ROI analytics: spend (ads APIs) ÷ receipted value per click-ID = cost-per-booking per creative; console + client report. (P1)
6. Objection intelligence → creative feedback (reply classifications per adset → creative insights). (P2)
7. Ada media-buying copilot: read-only account → ✦ guardrailed, approve-to-act suggestions (scale/nurture). Consistent with creation ruling. (P2)
8. Economics: connect free · metered credit actions (audience sync jobs, ad-lead enrichment) · value passback free (stickiness) · agency resells add-on at markup.
Sequencing: (1)+(2) first → (4) → (3) → (5) → (6)/(7). Compliance rails: consent at capture, SHA-256 hashed matches, suppression synced as exclusions, no raw cookie brokering ever.
Data adds: ad_context on contact, click_id store, audience_sync jobs table, ads add-on entitlement, ad-account read tokens.
PRD v2 §7 is the requirement contract (AR-1…AR-8).

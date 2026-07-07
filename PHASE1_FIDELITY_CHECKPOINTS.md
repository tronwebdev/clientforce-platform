# Phase 1 — Design-Fidelity Checkpoints (binding acceptance criteria)

> **For Claude Code.** For every Phase-1 screen, "matches the prototype" means passing the checks
> below. The binding source of truth is always the prototype file itself
> (`design_handoff_clientforce_restyle/prototypes/<Screen>.dc.html`) per `UI_PORTING_RULES.md`;
> the values printed here are **spot-checks** lifted from the prototype source so a reviewer (or you)
> can verify without re-deriving them. If a printed value ever disagrees with the prototype file,
> the prototype wins — and you log the discrepancy in `PROGRESS.md`.

---

## 0. Verification protocol (run before opening every UI PR)

1. Open the prototype `.dc.html` in a browser at **1440×900** and your built screen at the same size.
2. Capture the **full state matrix** for the screen (each state listed in its section below) as
   screenshots of both prototype and build.
3. Check, in order:
   - **Geometry:** every metric listed for the screen within **±2px** (rail/drawer/modal widths,
     grid templates, paddings, radii, control sizes).
   - **Color:** exact hex match on the listed elements (no "close" greens — `#35E834` ≠ `#2FB85C`).
   - **Type:** family, weight, and size on the listed elements (Bricolage Grotesque = display,
     Hanken Grotesk = everything else).
   - **Copy:** labels, badges, empty-state text **verbatim** from the prototype (unless it's mock
     data being replaced by live data).
   - **States:** every state in the screen's list exists and is reachable.
   - **Interactions:** the screen's interaction script passes end-to-end.
4. Attach the screenshot pairs to the PR and log the check in `PROGRESS.md` (§ Fidelity log).

Pixel-diffing is **not** required (font rasterization differs); geometry/color/copy/state/interaction
parity is. DOM structure does not need to match the prototype — behavior and appearance do.

**Global conventions (apply to every screen):**
- Canvas `#FBF7F0`; cards `#fff`, border `1px #EBE3D6`, radius 16–18, shadow `0 4px 16px rgba(14,21,18,.04)` (tables: radius 18, `0 6px 24px rgba(14,21,18,.05)`).
- Table anatomy: header row bg `#FBF7F0` with `1.5px` bottom border `#EBE3D6`; header labels 12px/700
  uppercase `#5C6B62`; body rows separated by `1px #F2EEE4`; row hover tint; 18px checkboxes with
  2px borders.
- Primary CTA: signature gradient `linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)`,
  text `#0A0F0C`, weight 700, radius 11, glow `0 6px 16px rgba(53,232,52,.26)`. **One** gradient CTA
  per view.
- Green text/icons on white use `#16A82A` (never `#35E834` as text). Success pills `#0F7A28` on `#D7F5DD`.
- Dropdown menus: `#fff`, radius 12, shadow `0 16px 44px rgba(0,0,0,.18)`, uppercase 10.5px section
  header, ✓ on the active row, **single-open** (opening one closes others), close on outside click.
- Drawers: fixed overlay scrim `rgba(12,20,15,.45)`; panel slides from right, bg `#FBF7F0`, white
  header band with `1px #EBE3D6` bottom border; shadow `-24px 0 70px rgba(0,0,0,.3)` class.
- Modals: centered, radius 18, bg `#FBF7F0` w/ white header band, shadow `0 30px 80px rgba(0,0,0,.32)`.
- Toasts: `#0C140F` pill, white text, radius 12, bottom-center, green status dot.
- Overlay behavior: Esc closes the topmost layer; scrim click closes; focus trapped inside; focus
  restored on close. Motion 150–220ms ease; respect `prefers-reduced-motion`.
- **States on every data view:** loading = **skeleton** (not a spinner), designed empty state (with
  CTA), error state (with retry), plus filtered-empty for lists ("no results for this filter" ≠
  "no data yet").
- Hit targets ≥ 44px; visible focus rings; `aria-label` on icon-only buttons.
- Responsive: fluid 1280–1920; **zero horizontal scroll at 1280**; <1280 out of scope this phase.

---

## 1. App shell + Sidebar — `sidebar.js` (binding), every screen

**Geometry & color**
- Sidebar: `#0C140F`, **248px** wide (the prototype literal — supersedes the 256px previously
  written here, per the "prototype values win" rule), full height, padding `22px 16px`; content
  area offset by exactly 248px.
- Logo row: 32px gradient mark (radius 9) + "Clientforce" in Bricolage 19px/700.
- Workspace switcher: row bg `rgba(255,255,255,.06)`, radius 12; 26px badge (radius 7, `#7FE8A0`
  initial); flyout panel with checkmarked active workspace.
- Main nav items (Dashboard, Agents, Contacts, Stats, Integrations, Automations): padding `11px 14px`,
  radius 12, 15px, icon column 20px, gap 12; active = weight **700** + fill; inactive = 500.
- Tools row with `▸` chevron → **flyout** at `left: calc(100% + 12px)`, width **264px**: Lead Finder V2
  (badge "Auto Prospecting"), Proposals (badge "Dynamic", cyan `#36D7ED`), Forms, Agent Widget,
  LinkedIn Extension. Tool items 14px, padding `9px 12px`, radius 10; badges 8.5px/800 pills.
- Bottom: Help row (flyout 240px: Help center / What's new / Contact support), Settings link, then
  profile block pinned bottom — bg `rgba(255,255,255,.05)`, radius 12, 34px gradient avatar, name
  14px/600, role 12px `rgba(255,255,255,.5)`, chevron flips open/closed.

**Interaction script**
1. Click Tools → flyout opens, chevron flips; click Workspace → workspace flyout opens **and Tools
   closes** (single-open). 2. Click outside → all close. 3. Active nav item reflects the current
   route on every Phase-1 page. 4. Switching workspace changes tenant context (lists re-scope).

**Wired in P1:** Agents, Contacts, Settings routes + workspace switcher. **Inert but present:**
Dashboard (stub w/ empty state), Stats, Integrations, Automations, all Tools items — real hrefs to
stub pages, never dead `#` links.

---

## 2. Agents List — `Agents List.dc.html`

**Geometry**
- Toolbar: search field + Status / Channel / More / **Columns** dropdown buttons. Active filter
  button state: bg `rgba(53,232,52,.08)`, border `#9FD8AC`, count chip. Columns menu 236px wide,
  checkbox rows toggle columns live.
- Table: card radius 18; header per global anatomy; first column "Agent" `minmax(0,1.7fr)`; grid
  template comes from the visible-columns state (port `gridCols`/`colDefs` logic from the prototype).
- Rows: avatar + name (sortable), status pill, channel chips, metric columns, row menu; row click →
  `/agents/[id]`. Selection → **bulk bar** appears.
- Pagination footer matching prototype.

**States:** skeleton rows · empty ("no agents yet" + gradient **New agent** CTA) · filtered-empty ·
error. **Interaction script:** sort by name ⇄; toggle a column off/on; filter by status; select 2
rows → bulk bar shows count; clear; click row → agent view.
**Data:** live agents for the workspace (RLS-scoped) — **one row per agent, one agent per goal**
(A5); status from `Agent.status`; counts real.

---

## 3. Create Agent wizard — `Create Agent.dc.html` (**6 steps** — the notes' 5-step table is superseded)

**Frame:** page bg `#FBF7F0` with `padding-left:64px`; **step rail 332px** (`flex:none`, padding
`26px 24px 0`, min-height 680px — the 1px `#EBE3D6` divider lives on the step content as
`border-left`, not on the rail); step rows padding 12px, radius 13, gap 13; active row filled,
completed rows checked. `‹ Back` (white secondary) + gradient `Next`/`Generate` in a **sticky
footer at the rail's viewport bottom** (`position:sticky;bottom:0`, bg `#FBF7F0`, padding-top 14px,
padding-bottom 24px); Generate dims to `opacity:.55` and is a **no-op** on step 1 while no context
exists (see the gating note below). Step title Bricolage 26px; subtitle 15px `#5C6B62`.
*(Amended in the wizard-v2 PR — prototype v2 moved the divider and made the footer sticky; the
previous "pinned at the rail bottom" wording is superseded.)*

Rail labels, verbatim: **1 Set the goal · 2 Design sequence · 3 Add contacts · 4 Enable lead capture ·
5 Guardrails & compliance · 6 Preview & launch.**

**Step 1 — Set the goal:** **nine** goal cards, grid `repeat(3,1fr)` gap 9 (cards radius 13,
padding `16px 14px`, hover/selected border swap) — verbatim: Book appointments 📅 · Generate
leads 🎯 · Reactivate leads ♻ · Drive sign-ups 🚀 · Collect reviews ⭐ · **Promote an offer 🏷 ·
Fill an event 🎟 · Upsell clients 📈** (v2 additions) · Custom goal ✎; picking a goal reveals the
green `✓ Goal: …` pill divider; **per-goal required-field gap rows** (v2): offer → offer details /
pricing / purchase link / deadline; event → event name / date & time / registration link / what
attendees get; upsell → what to pitch / who qualifies / pricing / booking link; all other goals
keep the base USP / pricing / availability rows;
**Knowledge base** list: an agent can have **any mix of sources — one or many** (URL, uploaded doc,
pasted text; connectors designed-but-inert): add-source picker is a 3-up choice (Upload doc / Add
URL / Connect source; connectors grid gap 7); each added source is its own row with its own
**IngestStatus** (PENDING → INGESTING → READY / FAILED) live from P1.2, an amber `Ingesting`
(`#D4A020`) → green `Ready` (`#16A82A`) status text, and a trailing **remove ✕** (`#C2B79F`,
hover `#B54B3A`); the URL panel's Add URL and the (clickable) doc dropzone both append a live
INGESTING row that flips to READY;
**About your business card** (header bg `#F7F9F8`, "used to personalise every message", Edit
action): shows the P1.3 distilled summary, editable; **Grounded-in footer** — one chip per
knowledge source (icon + label, pill border `#EBE3D6`, active `#35E834`); chip click reveals the
**verbatim cited passage** (quote block, 2px `#35E834` left border, italic) + source locator
(page/Q#) + which fields it backs + `Open source ↗`; data = P1.3 per-field `citations[]`;
**AI gap checker** (amber card: border `rgba(232,196,91,.48)`, bg `rgba(232,196,91,.04)`): header
"A few things the agent still needs" + "Not found in your docs — resolve before launching." +
`resolved/total` counter chip; green confirmation line "✓ Found in your docs:" followed by **one
chip per covered field** — clicking a chip reveals the same verbatim-quote evidence block (quote +
source locator + Open source), so "covered" is provable, not asserted; one row per gap (dot, label,
desc) with three states — missing → buttons
**Type it** (inline input appears, Clear resets) and **✦ Let AI** (chip flips to "✦ AI decides" +
Undo). Gaps come from the P1.3 completeness check; typed answers persist as TEXT knowledge /
context overrides and re-distill; **launch (step 6) is gated on every gap resolved** (typed or
delegated to AI); **zero-context state (v2)**: with no READY source and no typed answer, the gap
subline flips to amber-bold `No context yet — add a source or type answers before launch.`, the
green covered strip and its citation data are suppressed (empty, not hidden), and the About card
is replaced by a dashed empty card — `No business profile yet — add a knowledge source and we'll
distill one for personalisation.`;
"How should we build the sequence?" — 3 method cards, gap 9, **gated on ≥1 READY source or a
typed answer**: without context it renders the dashed locked placeholder `✦ Add a knowledge source
or answer a question above to unlock sequence building.` and Generate is dimmed + no-op.
*(Step-1 items amended in the wizard-v2 PR against prototype v2.)*
**Step 2 — Design sequence:** renders the **planner's CampaignGraph** (P1.4): one card per `step`
node (Step N label + email ChannelChip + `✦ AI draft` badge + `✎ Edit`), delay chips between from
`delay` nodes, the reply branch from the `branch` node. **Step editor = 560px right drawer**
(white, shadow `-24px 0 70px rgba(0,0,0,.28)`): header row = 40px channel icon tile + `STEP N` +
channel chip + subject title + `✕`; body = subject/body fields, **`✦ AI deliverability check`
card** (deterministically-computable rows only — subject length, reading level, read time, links,
"free" count; the AI-only /100 score and verdict are omitted until a real scorer exists) and the
**PERSONALIZATION chips** (the real merge-token set); footer = `✦ Rewrite with AI` · Cancel ·
gradient `Save step`. *(Amended in PR #34 — this section previously said "modal", stale vs the
updated prototype.)* Delay modal opens/closes; edits persist to the graph (new version,
`source: MANUAL`).
**Step 3 — Add contacts:** 3 source cards (`repeat(3,1fr)` gap 12); CSV modal flow; **manual-add
drawer** (480px, bg `#FBF7F0`, shadow `-24px 0 70px rgba(0,0,0,.28)`, scrim `rgba(12,20,15,.4)`):
header `Add contacts manually` (Bricolage 17) + 32px ✕; white form card (radius 14) with 11px/800
micro-caps labels — 2-col First/Last name, full-width Email, 2-col Company/**Phone** — and an
in-card tinted `+ Add contact` **multi-add** button; `ADDED THIS SESSION · N` micro-caps label over
rows with 34px initials avatars + red `Remove`; footer `N contacts ready to add` + gradient
`Add to campaign`. *(Amended in the wizard-v2 PR per DEC-039a — previously "minimal wiring".)*
Minimal wiring: CSV of ≥1 test contact + manual single add.
**Step 4 — Enable lead capture:** 2-col grid (`1fr 1fr`, gap 18); 48×28 gradient toggle; note
"This step is optional — you can skip it…" verbatim. **Visual only in P1** (toggle state persists,
no capture backend).
**Step 5 — Guardrails & compliance:** uppercase `#16A82A` section label **"Channels & senders"**;
email senders list (from P1.5 `SenderConnection`s); volume/deliverability limits editor (stepper
modal) writing the **Guardrails schema** (sending window, daily cap); consent/compliance toggles.
**Step 6 — Preview & launch:** 4-up summary cards (`repeat(4,1fr)` gap 12) incl. "Lead capture —
Enabled" pill; **Launch** → dark success state (`#0C140F` full-screen, fadeUp animation) then routes
to the agent view.

**States:** per-step validation (Next disabled until step valid) · knowledge ingest FAILED row state ·
planner "drafting sequence" building/loading state · launch success. **Interaction script:** complete
all 6 steps end-to-end creating a real Agent + primary Campaign + graph v1; back-navigation preserves
entries; editing a drafted step bumps the graph version.

---

## 4. Agent view (Campaign View) — `Campaign View.dc.html`

**Tab bar:** 8 tabs in prototype order — **Inbox ✉ · Calls ☎ · Steps ⋔ · Leads ☺ · Preview ◉ ·
Stats ▤ · Settings ⚙ · Logs ≣** (white bar, `1px #EBE3D6`, radius 14, **active = brand gradient**
with near-black text, per the prototype's `tabs` map — the earlier "ink fill" wording was stale;
amended in PR #36, owner-approved).
**Wired in P1:** Inbox, Steps, Leads, Settings, Logs. **Inert (visible, tab disabled-with-reason or
static mock):** Calls, Preview, Stats. Do not delete them.

**Leads tab**
- Table grid **`44px 1.9fr 1.3fr 1.1fr 1.05fr .7fr .9fr`**; body scroll region max-height 512px;
  global table anatomy; search + **source filter** dropdown + export + add; bulk bar (sequence /
  export / unsubscribe).
- **Lead detail drawer:** scrim `rgba(12,20,15,.45)`; panel **460px**, bg `#FBF7F0`, shadow
  `-24px 0 70px rgba(0,0,0,.32)`; white header (padding `20px 22px`). Contains the **activity
  timeline** — every persisted event for the lead (sent → delivered → opened → clicked → replied
  (+ intent chip) → stage change), newest first, from live `Event`/`Message` rows. This drawer is the
  human-visible proof of the engagement loop — it gets its own screenshot in every PR that touches it.

**Inbox tab:** intent category chips (`inboxCats`, verbatim: **All · Interested · Meeting booked ·
Replied · Question · Not interested · Auto-reply**) with live counts — categories ARE the P1.7
classifications (DEC-034 label set; the earlier "Not now / Objection" wording was stale vs the
prototype — amended in PR #35, owner-approved); `unsubscribe`-classified threads LEAVE the Inbox
(their home is Contacts → Unsub and the lead timeline); thread list (grouped per contact) → thread
view rendering **real `Message` bodies** (outbound + inbound); sort dropdown; mark-done; row menu.
Unclassified replies land in a visible bucket, never dropped.
**Steps tab:** "Main sequence · N steps" header; renders the **persisted graph** with per-step sent/
open/reply counts from events; same step cards as wizard step 2 (read-only acceptable for P1 if
editing stays in the wizard — note which in PROGRESS.md).
**Logs tab:** campaign-scoped event feed (the P1.7 stream) — every event row typed + timestamped;
the full enroll→send→reply→branch→stage sequence for the demo lead must be visible here.
**Settings tab:** Channels & senders block + **Tracking & compliance** toggles wired to the
Guardrails schema; sender rows open the **sender detail drawer** (500px, shadow `-28px 0 70px
rgba(0,0,0,.30)`) — port all conditional blocks (domain auth SPF/DKIM + Re-check DNS, health score,
sent-today; warmup/dedicated-IP/OAuth/SMTP blocks render per sender type, inert where the backend
doesn't drive them yet). **Volume/limits modal:** 460px, radius 18, stepper controls (26px round
+/− in pill track).

**States:** each tab has skeleton + empty (e.g. Inbox: "No replies yet"; Logs: "No activity yet") ·
error. **Interaction script:** open lead drawer from Leads; scrim/Esc closes; switch all 5 wired
tabs; classify-and-file a simulated reply appears under its intent chip with count bump; Logs shows
the event within one poll interval (≤5s).

---

## 5. Contacts — `Contacts.dc.html`

- **Segment tabs** verbatim: `All · New · Replied · Qualified · Booked · Unsub` — implemented as the
  §A10 query mapping (not fake stage values).
- Table grid **`46px minmax(0,1.9fr) 1.2fr .95fr 1.15fr .85fr .95fr 44px`** (trailing 44px = row
  menu); sortable Contact + Status columns (arrow indicators); status pills colored per prototype
  (`r.sbg`/`r.sfg` pairs); quick toggles (Replied only / Booked only / Subscribed only); status
  dropdown filter; bulk bar; **contact drawer** with profile + timeline.
- **States:** skeleton · true-empty (import CTA) · filtered-empty · error.
- **Interaction script:** switch each segment (counts change consistently with the mapping); sort by
  status ⇄; open contact drawer; bulk-select → unsubscribe updates `optOut` + Suppression and the row
  pill flips.

---

## 6. Settings → Channels & Suppression — `Settings.dc.html`

- Left sub-nav (7 sections); **Channels + Suppression + Brand kit wired**; others render inert with
  real layouts (no dead ends — each shows its prototype layout with mock/disabled controls).
- **Brand kit (workspace knowledge — the canonical BusinessContext surface):** "Brand knowledge"
  header + gradient Save; **Agent summary** dark card (`#0C140F`, radius 18) — distilled sections
  (count chip, expand/collapse all, per-section edit), "Auto-generated from your docs, sources,
  offer & guardrails", **↻ Regenerate** (re-runs P1.3) + Save; **per-section provenance + citations**:
  collapsed rows show a provenance chip (`N sources` `rgba(255,255,255,.38)` / `✦ AI-inferred`
  `#EFCB68` / `✎ edited` `#7FE8A0`); expanded sections show a **Grounded in** chip row (dark pills,
  active border `#7FE8A0`) — chip click reveals the verbatim cited quote (2px `#7FE8A0` left border)
  + source locator + `Open source ↗`; **editing a section flips it to "✎ Edited by you — overrides
  docs" with ↺ Revert** (restores the distilled body); AI-inferred sections carry an amber note
  "✦ Inferred by AI — no direct source in your docs. Edit to confirm, or add a doc and regenerate.";
  Regenerate clears edits + citations refresh; **Company docs** upload (PDF, DOCX,
  XLSX, TXT, MD · 25 MB — ⚠ Q-009: XLSX extraction not yet in P1.2; at wiring time the accept
  list must match the extractor's real capabilities, never advertise a format that fails after
  upload) → workspace-level P1.2 ingestion with live IngestStatus rows; Company
  description + Core offer fields; **Guardrails writing rules** tagged Always / Never / Tone (fed
  to the planner). Connect-a-source grid + Brand identity (logo/colors/tagline) render inert.
- **Email senders table:** columns = sender, sending status, receiving status, domain-auth badges
  (SPF/DKIM pass/fail pills), daily limit, sender id; row → sender detail drawer (same 500px drawer
  as §4). "Add sender" flow = P1.5 connect surface (CF Mailer / Gmail / Outlook / SMTP picker;
  only CF_MANAGED completes in P1 — the others show their designed forms with a "coming soon"
  submit state, logged as inert).
- **Suppression list:** table of suppressed addresses (address, channel, reason, source, date) +
  add/remove; **wired to the real `Suppression` model** — adding an address here must actually block
  a send (this is tested in P1.5's acceptance).

---

## 7. Login (dev auth) — minimal fidelity

Phase 1 keeps dev-auth. The login page must still be on-system: `#FBF7F0` canvas, card per global
anatomy, Bricolage heading, gradient primary button, proper focus states. Full Onboarding flow
(`Onboarding.dc.html`: auth → verify → onboarding → first-run) is **out of scope** until the auth
provider decision (tracked in PROGRESS.md §Open questions).

---

## 8. Screenshot deliverable per PR (the review gate)

Every UI PR attaches, at 1440×900: default state · loading skeleton · empty state · error state ·
each overlay open (drawer/modal/dropdown) · each wired tab/segment — **prototype next to build** for
each. Stateful controls additionally show closed *and* open (the T6 sidebar slip rule). The PR
description lists any deliberate deviation with its PROGRESS.md decision ID; undocumented deviations
are review-blockers.

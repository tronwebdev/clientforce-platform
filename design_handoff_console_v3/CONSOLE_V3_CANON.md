# Console v3 — Design Canon

Source of truth for the "quiet confidence" refresh. Design origin: the
Clientforce UI Redesign project (`Console v3 Build Spec`, `Agent Identity &
States`, `Agent Widget v3 — Mock`, `Clientforce Console`). Commit this file so
implementations read canon instead of relaying through chat.

Status: LOCKED by owner 2026-07-12. Applies to new work. The shipped app still
wears the legacy skin; the re-skin is a separately sequenced build unit.

---

## 1 · Color tokens

| Token | Hex | Use |
|---|---|---|
| wash | `#E9EFEA` | Page background |
| panel | `#FBFDFB` | Rail · dock · lists |
| card | `#FFFFFF` | Cards · thread |
| ink | `#101613` | Primary text |
| muted | `#5A6660` | Secondary text |
| faint | `#8B968F` | Labels · meta · placeholder |
| line | `#E9EEEA` | Structure hairline |
| line-input | `#DCE5DE` | Input · button hairline |
| line-soft | `#E2EAE4` | Inner dividers |
| **forest** | `#146B33` | THE accent — links, primary buttons, live numbers |
| forest-deep | `#0F5227` | Hover / pressed accent |
| mint | `#EAF5EE` | Selected · chips · good-state fill |
| mint-line | `#CFE8D8` | Mint border |
| warn | `#8A6D1A` on `#F7EFDA` | Needs-you |
| danger | `#B0483A` | Held / error |

**Retired — must never return:** `#16A82A`, `#0F7A28` (pre-refresh greens),
warm cream surfaces (`#FBF7F0`, `#F7F9F8`), dark sidebar `#0C140F`.

**Signature gradient:** `linear-gradient(135deg,#36D7ED,#35E834 55%,#D0F56B)`.
Logo mark, agent mark, and at most one or two moments per screen (active-tab
underline, progress edge, 2–3px card top edge). Never fills, buttons, toggles,
or large surfaces. `#35E834` appears **only** inside this gradient and in
motion — never as a solid fill.

**Hero ink:** `linear-gradient(180deg,#101613 25%,#14743A 120%)` via
`background-clip:text`, largest headline on a surface only.

---

## 2 · Semantic label system

Pipeline stages are a temperature ramp — color encodes lead warmth:

| Stage | fg | bg | border |
|---|---|---|---|
| New | `#5A6660` | `#F1F4F2` | `#E2EAE4` |
| Contacted | `#356170` | `#EAF3F5` | `#CFE4E9` |
| Engaged | `#0E7D93` | `#E2F3F6` | `#BFE3EB` |
| Interested | `#8A6D1A` | `#F7EFDA` | `#EAD9A8` |
| Booked | `#146B33` | `#EAF5EE` | `#CFE8D8` |
| Won | `#FFFFFF` | `#146B33` | `#0F5227` |
| Lost | `#B0483A` | `#FBEEEA` | `#F0CFC8` |

Inbox reply categories reuse the same temperatures (Interested=forest,
Question=gold, Not interested=danger, Auto-reply=slate).

Operational states: Live/Won forest · Scheduled teal · Draft/Off slate ·
Paused/Needs-you amber · Held/Error danger. Always a bordered pill.

Channels carry a **subtle distinct tint**, not a full color — meaning-bearing
labels (stage/state) own the color weight:

| Channel | fg | bg | border |
|---|---|---|---|
| Email | `#146B33` | `#F1F8F3` | `#DCEBE1` |
| SMS | `#0E7D93` | `#F0F8FA` | `#D5EAEF` |
| WhatsApp | `#2E7D4F` | `#F1F8F3` | `#D8EADF` |
| Voice | `#8A6D1A` | `#FBF6E9` | `#EEE0BF` |

---

## 3 · Type

- Display / headings: **Schibsted Grotesk** 800–900, tracking −.02 to −.035em
- Body / UI: **Schibsted Grotesk** 400–600 (Direction D — cohesive grotesk)
- Data / IDs / timestamps: **IBM Plex Mono** 500

Scale: H1 32px/900 · H2 22px/800 · H3 16px/700 · body 14.5px/400 ·
UI label 13px/600 · eyebrow 11px/700 .08em uppercase · mono data 12px/500.

---

## 4 · Radius, space, elevation

Radius: 9–12 small (chips, inputs, buttons) · 14–16 cards · 22 frames ·
`999px` status pills.

Space: layout runs on flex/grid `gap` — 4 / 8 / 12 / 16 / 22 / 30.

**Elevation (Direction D — hybrid):** soft borderless lift on floating and
top-level cards; **hairlines carry dense internal structure** (list rows, metric
tiles, nested panels). Never all-shadow at depth — it turns to mush.

- Card float: `0 1px 2px rgba(16,22,19,.04), 0 10px 30px rgba(16,22,19,.07)`
- Panel/overlay float: `0 1px 2px rgba(16,22,19,.05), 0 18px 44px rgba(16,22,19,.16)`
- Everything else: hairline borders, no shadow.

Widget exception: launcher + panel float over unknown host backgrounds; all
widget internals stay flat + hairline.

---

## 5 · Motion

Event-driven only — the UI never fakes busy. All animation disabled under
`prefers-reduced-motion`.

| Verb | Timing | Meaning |
|---|---|---|
| breathe | 3.6s ease-in-out | idle / ready mark |
| ping | 2.2s ease-out | listening · needs-you badge (border ring) |
| spin | 2.4s linear | thinking (conic ring) |
| slide | 1.7s ease-in-out | replying / working progress sweep |
| glow | 4.5s ease-in-out | Ada's composer presence |

---

## 6 · Agent identity & states

The agent (default name **Ada**) is one identity across chat, email, calls and
the chatbot. The mark is the ✦ glyph on the signature gradient.

**Five console states:** `ready` · `thinking` · `working` · `needs-you` ·
`held`. The widget's four chat verbs (idle/listening/thinking/replying) map into
these — do **not** force a fifth state into the widget.

| State | Mark treatment | Pill |
|---|---|---|
| ready | breathe | mint / forest |
| thinking | spin ring | mint |
| working | slide bar under mark | mint + live count |
| needs-you | ping badge | warn `#8A6D1A` on `#F7EFDA` |
| held | static | danger `#B0483A` |

✦ marks anything AI-composed, always beside an honest provenance line
(e.g. "Drafted by Ada from your business profile · nothing sends until you
launch"). Honest absence: never fake data or a loud glow — an unconnected
surface shows a quiet hairline "connect" affordance.

---

## 7 · Widget carryovers (closes the flagged prototype literals)

- **Presence / live dot:** forest `#146B33`.
- **Launcher unread badge:** forest `#146B33` fill, white numerals, 2px white ring.
- **Voice overlay:** background is **light** — panel `#FBFDFB`, not the retired
  dark surface. Orb = signature gradient with ✦. Waveform bars forest
  `#146B33`. Hang-up danger `#B0483A`. Mute neutral (white + hairline;
  active `#FBEEEA` / `#B0483A`).
- **Dark set:** the v3 widget is **light-first — there is no dark canon.** Do not
  port the legacy dark set. A dark theme, if wanted later, is a new design
  decision, not a prototype carryover.

---

## 8 · Shell (console)

Floating rounded rail + canvas + 56px icon dock on the wash; frame radius 22,
padding 14, zone gap 14.

- **Left rail (262px):** logo, workspace switcher, campaign list with ✦ suggested
  campaigns, prominent Business Core card (Knowledge / ICP / Train).
- **Canvas (max 880px):** status band with the lens toggle inside it —
  Overview · Steps(Plan) · Pipeline · Inbox · Stats, plus a ⚙ Settings gear.
  Leads = Pipeline's list view; Calls = an Inbox filter.
- **Right dock (56px):** icon-only, each tile filled with its own tint + matching
  hairline border, active tile solid in its OWN surface color + white icon, hover
  label pill to the left. Console tile is the ✦ mark with a gradient underline.
  Inbox carries the needs-you ping badge.
- **Receptionist tile** sits alone at the TOP of the dock column in its own frame
  (add-on product mark: gradient square + headset, greyscale until added); the nav
  dock stays vertically centered below it.
- **Ada composer** pinned at the canvas foot with the glow presence.
- **Selected campaign card** grows a mint bubble tail on its right edge — the
  campaign "opens out" into the canvas like a speech bubble.
- **Settings** is a labeled chip ("⚙ Settings") on the tab row's right, in the
  slate-teal family (#356170 on #EAF3F5; solid #356170 + white when active) —
  visually a different class from content tabs.

## 8d · Focus layout (owner ruling, 2026-08-12 — binding)

The subject of the screen owns the screen, with exactly ONE choreography and no
per-click animations. Entering a campaign (and first load) the page sits UNCHANGED for
~6 seconds the page IS a normal page — rail in flow, dock unfolded, campaign
untransformed, for ~25 seconds. Then everything moves TOGETHER, slowly: the rail
dissolves in place (opacity 2.8s, drift -30px), the dock folds (3.8s), and the
campaign COMES TO YOU in the same breath — a pure centered zoom, cfApproach scale
.885→1 over 4.2s, cubic-bezier(.33,.02,.1,1), no translate. Reopening
mirrors it (cfRecede). Width never animates. The collapsed rail is NOT a full-height
bar: a compact pill only as tall as its content (mark · » · count · vertical
CAMPAIGNS, glowing) with the B business tile standing alone at the bottom
(mark · » · count · vertical CAMPAIGNS · B). Clicking the strip reverses the same
choreography in flow — fade-in leads, canvas eases back — never an overlay; pointer
returning to the campaign sends a manually-opened rail away again. Pushing is reserved
for the dock alone: its nav icons fold/unfold vertically into the Console tile
(needs-you dot when folded; receptionist + divider stay separate above) at the same
slow ease; always open on non-console surfaces. Canvas max 1120px centered. Brand
stays the locked Quiet-confidence tokens.

## 8a · Density & labels (owner ruling, 2026-08-12 — binding)

The console was drowning in labels. These rules are binding on every surface:

1. **One signal per list row, max.** A row carries name + preview + time and AT MOST
   one status treatment. Never stack channel chip + category pill + tie chip on a row.
2. **Category/status = the 3px left accent bar (always tinted) or a small dot** — the
   word ("Interested", "Booked") appears only in the OPEN item's header, once.
3. **Channel = a bare muted glyph (✉ ❝ ☎ ◧) inline with the preview** — never a
   bordered chip in lists. Channel filters are icon-square toggles, right-aligned on the
   same row as the primary filter — never a second labeled chip row.
4. **Mono ALL-CAPS labels are for section headers in editors/settings only** — never
   inside list rows, meta lines, or cards on operational surfaces. Row-level labels are
   lowercase, plain, muted.
5. **Global truths are stated once** (approval-before-send, AI provenance) — in the
   surface header or footer, never repeated per row/card.
6. **Beyond two visible actions, collapse into ⋯** (menu carries Move-to + secondary
   actions). ✓ Done stays visible; everything else earns its place.
7. **Campaign rail: status = dot (title tooltip carries the word), ✦ marks suggested
   origin.** No status pills in the rail.
8. **Chips are for actionable/filter state the user set**, not for describing data the
   layout already communicates.
9. **One narration card per surface.** Ada speaks once (the surface's narrated header);
   never a second summary strip. Counts live in the surface header line — never repeated
   on filter chips.
9b. **Create is guided, manage is direct (§8b ruling, amended by owner 2026-08-12).**
   Creation flows through the ONE Ada surface: the "Ask Ada" bar/buttons open the
   existing Ada pop-up, and the guided steps render INSIDE it as the conversation —
   ask bubble → Ada intro → visual template cards (★ industry-recommended) → one spec
   step (field chips / behavior toggles / three plain questions) → a DRAFT, never live.
   NEVER a separate sheet or second Ada surface. Managing what exists (edit fields,
   flip live, copy links, nudge) is direct UI on the surface.
9c. **Entity pages share one anatomy.** Back link + name + status pill · a 4-tile stat
   strip answering the surface's first questions (how many, converting, last event,
   routed where) · segment tabs (main view · activity/records · settings) · danger rows
   live at the bottom of Settings, honestly worded. Detail depth goes IN the segments,
   never scattered around the main view.
10. **Narration is entity-aware.** Opening an entity inside a surface (a contact today;
   a call, list, or automation tomorrow) retargets the SAME narrated header: identity
   line becomes "Name · state", Ada's line speaks about that entity from its live data
   (stats, last event, what's waiting), chips become that entity's next actions. Closing
   restores surface narration. Never a second card, never a static repeat of the hero.

Dock surfaces are **narrated**: Ada's line + action chips on top, then an
inspect list. Light edits happen in place; creation flows through Ada.

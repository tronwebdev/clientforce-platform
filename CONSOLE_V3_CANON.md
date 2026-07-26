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
| bubble-agent | `#F2F6F3` | Agent message surface (widget + console thread) |

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
- **Platform attribution.** Every widget panel carries "Powered by Clientforce Ai"
  in the foot — 10.5px faint text behind an 11px gradient square. This is
  default-on and **not workspace-configurable**. It may be suppressed only for
  workspaces owned by an agency whose plan tier includes white-label;
  suppression is **plan-gated, never a user toggle** (and never a client-side
  option — the embed has no attribute or init flag that can switch it off).
- **Two layers, kept separate.** *Widget appearance* — accent color, logo/mark,
  and which flows are enabled — is **workspace-level and ungated**: any
  workspace configures it from widget setup, with no plan check. *White-label*
  is solely the suppression of the attribution line above, and is the only
  plan-gated piece.

---

## 8 · Shell (console)

Floating rounded rail + canvas + 56px icon dock on the wash; frame radius 22,
padding 14, zone gap 14.

- **Left rail (262px):** logo, workspace switcher, campaign list with ✦ suggested
  campaigns, prominent Business Core card (Knowledge / ICP / Train).
- **Canvas (max 880px):** status band with the lens toggle inside it —
  Overview · Steps(Plan) · Pipeline · Inbox · Stats, plus a ⚙ Settings gear.
  Leads = Pipeline's list view; Calls = an Inbox filter.
- **Right dock (56px):** icon-only, each tile filled with its own tint, active
  tile solid forest + white icon, hover label pill to the left. Console tile is
  the ✦ mark with a gradient underline. Inbox carries the needs-you ping badge.
- **Ada composer** pinned at the canvas foot with the glow presence.

Dock surfaces are **narrated**: Ada's line + action chips on top, then an
inspect list. Light edits happen in place; creation flows through Ada.

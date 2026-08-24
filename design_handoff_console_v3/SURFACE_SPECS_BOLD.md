# SURFACE SPECS — Console **Bold**
Per-surface contract: layout anatomy → states → interactions → data → Ada → empty/edge. Supersedes `SURFACE_SPECS.md` (v3-era) for every surface listed here. Pixel truth: `prototypes/Console Bold.dc.html`.

Convention: **must** = built and verified in the prototype, port it. **Ruling** = a decision with a rejected alternative behind it (see `DECISION_LOG_BOLD.md`) — do not re-litigate.

---

## 1 · Shell

**Anatomy** `100vh · overflow:hidden · padding:26px · gap:18px` → rail 228 / canvas flex:1 / dock 52.

**States**
| State | Behaviour |
|---|---|
| Default | all three columns visible |
| Rail collapsed | rail → icon column; toggle is an **icon**, not a labelled button (ruling) |
| Focus mode | user-invoked only via icon. **No auto-focus** — the timed auto-zoom was built, tuned over six rounds, then removed (ruling) |
| Campaign selected | canvas shows campaign tabs; chat-bubble pointer protrudes from the canvas edge toward the active dock tile |

**Interactions** — rail collapse, focus toggle, workspace switch, dock navigation, campaign selection, tour launch.

**Edge** — at 924×540 everything must still fit: 11 dock tiles, Ada bar, rail bottom card. Verified size; treat as the floor.

---

## 2 · Rail

**Blocks, in order:** workspace card → `CAMPAIGNS` → `ALWAYS ON` → ICP/credits card (pinned).

### 2.1 Workspace card
Mark, business name, chevron. **Is a workspace selector**, not a label (ruling). Opens the workspace list; switching reloads every surface against the new workspace.

### 2.2 Campaigns
Row: name · goal chip · live value. Active row: mint fill + forest text.
**Ada's proposals are rows in this list** (ruling) — amber left spine, `Ada's idea` pill, **Start** action. One muted suggestion at a time; the standalone rail block was built and rejected.
Empty: "No campaigns yet" + Ada's first proposal as the only row.

### 2.3 Always on / inbound
Two rows — **Site agent**, **Receptionist** — under an `ALWAYS ON` / `INBOUND` eyebrow pair.
Row anatomy: icon tile · name · live dot (pulsing `#35E834`) · sub-line (`61 chats · 14 booked this month`) · value (`$33.6k`).
Four states each: live-busy, live-idle, add-on-not-purchased (`$39/mo`, muted), not-installed (amber, `no traffic answered`, `$0`).

### 2.4 ICP + credits
Mark · name · sector · `14 facts / 2 gaps` · credit balance · **Top up**. No prose (ruling — the description line was removed for height). Pinned `flex:none`.

---

## 3 · Dock

11 tiles, order fixed: `Receptionist · Inbox · Contacts · Lead finder · Automations · Forms · Site agent · Proposals · Analytics · Integrations · Settings`.
Receptionist sits alone at top with a gap — it is an add-on with its own identity.

| Indicator | When | Token |
|---|---|---|
| Pulsing dot | Receptionist live · Site agent has an active chat | `#35E834` |
| Solid dot | Site agent not installed | `#E0A83A` |
| Mint fill + forest icon | active surface | `#EAF5EE` / `#146B33` |

Titles are dynamic and must match state: `Site agent · 2 chatting` / `· not on your site`, `Receptionist · live`.
Icon set: **Style A** (Style B saved as the alternate — do not invent a third).

---

## 4 · Campaign surfaces

Tabs: `Overview · Pipeline · Plan · Inbox · Stats · Settings`.

### 4.1 Overview
**Hero** — goal label stated explicitly, one-line description of what that goal means, value expectation for the goal type, live status.
**Stats** — **one row** (ruling; two rows rejected). Every figure carries a qualifier: `8 of 12 booked`, never `8`.
**Happening now** — live pulse.
**Recent activity** — colour-coded by type, avatars on contact rows, each row clickable to its subject. `View all` → activity page.
**Ada read** — what she is doing next and why.
Empty: campaign created but not started → the plan preview and a Start action, no zeroed stats.

### 4.2 Activity page (`vActivity`)
Reached only from `View all` (ruling — not a tab). Day groups, type filters, sortable.
Row types: sent · opened · replied · classified · booked · escalated · quoted · paid · no-show · re-engaged · handed over · rule fired · credit charged.
**A row with a count drills into the subset** — `sent to 22` opens those 22, sorted (must).
Every row resolves to a subject: contact, thread, booking, proposal, rule.

### 4.3 Pipeline
**Board and list**, toggleable. Board columns carry counts and notch labels. Cards: avatar, name, value, last touch, channel. Drag between stages. List view: sortable table of the same data.

### 4.4 Plan
Steps render on a **vertical line with nodes** (ruling — the dense card stack was rejected). Each node opens a detail sheet:
- email → subject, preview text, length checks, body
- SMS → body + character/segment count
- call → script outline
- delay → editable duration
- **credit cost per step**, always shown

`Add a step` inserts a real step. Timezone is editable. **Branches and rules kept but simplified** — one summary line per branch, expand for the rule vocabulary (`campaign-rules.ts` unions verbatim). Reply categories: interested · question · objection · not now · unsubscribe.

### 4.5 Campaign inbox / workspace inbox
Same component, different scope.
**Three dropdowns** (ruling — chip rows rejected): `TYPE`, `STATUS`, `SORT`. Each menu row = colour dot + label + **live count**.
Types: All · Email · SMS · **Web chat** · Calls · **Client messages**.
Thread pane: messages, Ada's draft with approve/edit/send, provenance pill for site-agent threads (`Site agent · came from your Meta ad · booked in 3 minutes`), contact peek.
Actions live: move, assign, snooze, approve, open contact, add to list.
Workspace scope adds a workspace-wide selector and campaign attribution per thread.

### 4.6 Stats / Settings (campaign)
Stats: goal-typed metrics with money expression. Settings: campaign-level guardrails, sending window, senders, arc/language/strategy from the shipped build — **distinct from workspace guardrails** (ruling).

---

## 5 · Goal types (10)

| key | label | value basis |
|---|---|---|
| `book` | Book appointments | value per booking |
| `sell` | Sell a product | price per unit |
| `revive` | Bring people back | average visit value |
| `review` | Collect reviews | no direct revenue |
| `lead` | Find new business | value per closed deal |
| `quote` | Get quotes accepted | value per accepted quote |
| `event` | Fill an event | value per attendee |
| `renew` | Renew or resubscribe | value per renewal |
| `nurture` | Warm people up slowly | no direct revenue |
| `winback` | Win back lost deals | value per recovered deal |

Every goal expresses **count and money together** — `8 booked × $2,400 = $19.2k potential`. "Booked" is not universal (ruling). Goal is chosen first in creation and the whole surface follows it: hero copy, stat labels, pipeline stages, plan defaults, Ada's chips.

---

## 6 · Create campaign

Steps: goal → audience (CSV upload / list / lead-finder results, with customer-vs-prospect typing) → **knowledge check** (goal-driven; asks only for facts the Core lacks for *this* goal) → plan preview incl. reply / no-reply branch rules → value expectation → review → start.
Every step is functional in the prototype; the CSV step really ingests.

---

## 7 · Contacts

List/grid toggle · search · segment toggle (All / Prospects / Customers, aggregating across lists) · lists sidebar with create-list.
Rows carry avatar (circular, real photo), name, email, **phone**, tag, last touch, value.
**Detail**: avatar header row (must — it went missing twice), call / message / add-to-list / tag / note actions, campaigns this contact is in, full timeline, ad-context rows where present, custom fields.
**Add to list is available anywhere a contact appears** (ruling).
CSV upload: mapping, customer/prospect typing as a primary toggle, dedupe preview.

---

## 8 · Site agent (was Chatbot)

**Renamed everywhere** (ruling — it is a channel, not a toy).
Header: `INBOUND CHANNEL · ON YOUR SITE` / `· NOT INSTALLED`.

| State | Surface behaviour |
|---|---|
| Installed | pulse strip, verified date, `Remove from site`; cards show `61 chats · 14 booked`, 23% |
| Not installed | amber banner *"She is not on your site yet"* + `Add it to my site`; cards read `Not on your site`, no conversion figure; rail row amber `$0`; dock amber dot; Ada line changes |

**One flag drives all six surfaces** (must — partial wiring produced self-contradicting screens in review).
Build: Ada guided flow covering greeting, sources, behaviour, appearance, escalation, redirect. **Live preview inside the setup**, not a separate tab (ruling). Appearance matches `Agent Widget v3 - Mock.dc.html`. Embed code + verify step.

---

## 9 · Receptionist add-on

Pop-out, not a page. **Incoming call**: `INCOMING CALL`, caller, `Not in your contacts`, ringing treatment, two actions — **Take the call** / **Let her handle it**.
Setup: 3 steps. Rules editable post-setup. Call list with transcripts, outcome and value per call.
`$39/mo` disappears once live; pop-out background changes when active; dock dot pulses.

---

## 10 · Forms · Proposals · Automations

Each: card grid → detail → editor → Ada guided build.
- **Forms** — field types incl. multiple choice, validation, redirect/thank-you, routing destination, response inbox with unread indicators, embed/hosted link, submission count.
- **Proposals** — cover-first stack, template gallery with filters, live block editor (add/edit/reorder in place, edits visible immediately), video blocks, pricing tables, view/sign tracking. Default view is **your proposals**, not templates (ruling).
- **Automations** — single `New automation` button → choose build-yourself or with-Ada (ruling — two listed options rejected). Builder carries the full shipped trigger/action vocabulary, not a shortlist.

Ada's guided build on each runs **in the chat**, not a popup wizard (ruling), and must reach a genuinely complete artifact — every setting the manual editor exposes.

---

## 11 · Lead finder

**Two modes** (ruling).
- **Ada mode** — pre-run ICP result shows first if present; `Run a new search` reveals parameters; results on run. Staged, never all at once.
- **Direct mode** — filter-first people/company search for operators who know their query.
Rows: company/person, fit score, signals, contact availability. Actions: add to list, enroll to campaign, enrich (credit-charged chip).
**BuyerPing** is a second tier with its own connect flow, not the headline.

---

## 12 · Settings & Business core

**One surface** (ruling — workspace settings and business profile were merged; they must not link out to each other).
Header: centred gear tile, `Settings and Business core` 34px/900 gradient ink, description, status pills.
Groups: **Senders** (top, own heading) → what the agent knows (identity, offer, voice, ICP, knowledge sources) → guardrails (**workspace-wide**, distinct from campaign) → team & roles → channels → credits (spend only).
Every field directly editable. Senders clickable to full detail. **Add email** and **add number** are separate wizards with real provider icons and the shipped connect steps.

---

## 13 · Credits (workspace)

Spend only: balance, burn rate, runs-out estimate, breakdown per agent / channel / campaign, history, top-up.
**Plans, cards, invoices are account-owner side** (ruling).

---

## 14 · Ada bar

Pinned bottom of the canvas column, always visible. **Contextual per surface**: label, placeholder and 2–4 chips change with the active surface and selection. On a campaign it offers campaign questions; on lead finder, search prompts; on forms, build prompts. Suppressed only on an unentitled add-on showcase (Addendum 3 §C).

---

## 15 · Tour

Anchored walkthrough over `ws · camps · sugg · core · canvas · tabs · hero · act · ada · dock`. Plus **per-page help on every surface**, not campaigns only (ruling).

---

## 16 · First run

Specified in `ADDENDUM_4_BOLD.md` §5 — auth (3 screens), Core assembly (6 steps), ghost dock, plan screen with **card capture** via Stripe Elements + SetupIntent.

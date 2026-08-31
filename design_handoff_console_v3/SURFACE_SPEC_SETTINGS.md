# SURFACE SPEC — Settings, Business core, Credits & usage

**Status:** owner-locked 2026-08-31. Pixel truth: `prototypes/Console Bold.dc.html`
(dock item 11 → Settings; the Credits surface via the hub row or the rail's `Top up`).
This spec exists because B7 shipped a **thin** version of these surfaces: the layout landed,
most of the *actions* did not. Where the live build and this spec disagree, this spec wins.

---

## 1 · What is missing today (owner review, verbatim list + what it implies)

| Missing in the build | What must exist |
|---|---|
| No way to **add something she should know** | `Add a fact` drawer (question → answer), writes a core fact |
| No way to **answer a gap** | Gap row → same drawer, pre-filled with the asked question; answering removes the gap |
| No way to **add a knowledge source** | `Add a knowledge source` drawer (website / document / typed), starts ingest |
| No way to **add a phone number** | `Add a number` drawer (area → what it carries → A2P filing) |
| Email sender add **does not use the right-hand drawer** | every add/edit in settings opens the **same right drawer**, never an inline form or a modal |
| **Credits and usage** looks nothing like the design | the dark hero, four tiles, three tabs, usage bars, rates table, top-ups + buy flow (§9) |
| **Invite someone** absent (also absent from the proto) | invite drawer, now designed and in the proto (§7) |
| Style/depth inconsistent across the page | the style contract in §2 is normative, not decorative |

The pattern behind every line: **B7 built the read layer and skipped the write layer.**
This unit is the write layer, on one shared drawer.

---

## 2 · Style contract (normative for this unit and every surface it touches)

Per CLAUDE.md as amended 2026-08-16 for console-family work:

- **Two-layer elevation** on cards, drawers and sheets: `0 1px 2px rgba(16,22,19,.04)` contact
  plus `0 18px 34px -22px rgba(16,22,19,.10)` ambient. Hard grey drop shadows stay banned;
  hairlines still carry structure.
- **Panel gradients** `#FFFFFF → #F7FAF8` on raised cards; flat `#FCFCFC` on quiet cards.
- **Inputs are recessed wells**, never more white boxes: `#F4F6F5` + `inset 0 1px 2px
  rgba(16,22,19,.05)` + `1px solid #DFE3E1`. This applies to every field in every add drawer.
- **Radii** (console step): 10–14 small, 16–18 cards, 20–22 drawers/frames, `999px` status.
- **Hairlines** `#E4E6E5` / `#ECEDEC` / `#F1F2F1` (row separators) / `#EAEBEA`.
- **Colour roles**: forest `#146B33` = Ada / live / primary action; cyan `#0E7D93` = navigate
  and inspect; amber `#8A6D1A` on `#F7EFDA` = needs-you; red `#B0483A` = destructive.
  Forest is not the only voice — a "see it" link is cyan, not green.
- **Every popover, drawer and sheet dims the page behind it**: scrim
  `position:fixed; inset:0; rgba(16,22,19,.26)`, one z-layer below the surface,
  click-to-close. (Recorded console-wide; apply here and wherever else you touch.)
- **Type**: Schibsted Grotesk 900 for titles (28px/-.04em page, 18–22px card) with gradient
  ink `linear-gradient(180deg,#101613 25%,#14743A 120%)` on page titles; IBM Plex Sans 400–700
  body; IBM Plex Mono 500 for eyebrows, IDs, record lines, prices and counts.
- **Gradient** (`#36D7ED → #35E834 → #D0F56B`) is allowed on at most one or two moments per
  screen — never a button fill, never a large surface.
- ✦ marks anything AI-composed, always with an honest provenance line.

---

## 3 · Settings hub

A responsive grid, `minmax(240px,1fr)`, six cards. Each: tinted icon tile, name, one-line
description of what lives inside, an optional status pill, arrow affordance, whole card
clickable.

| Card | Description | Pill | Goes to |
|---|---|---|---|
| Business core | Who you are, what you sell, hours and prices. Everything Ada quotes. | `2 gaps` warn | item `ws:core` |
| Senders | Two email domains and one number. Warm-up is at 82%. | `All verified` live | item `ws:senders` |
| Team and roles | Two people plus Ada. Owner, admin, viewer. | — | item `ws:team` |
| Guardrails | Workspace-wide limits every campaign inherits. | — | item `ws:guard` |
| Credits and usage | 2,340 left. Where they go, what things cost, top up. | — | surface `credits` |
| Integrations | Calendar, Stripe and the ads closed loop. | `3 connected` live | surface `integrations` |

Every pill count is server-derived. A card whose subtitle states a number it cannot compute
must state the honest absence instead (e.g. "Warm-up not started").

---

## 4 · Shared item-page anatomy

All four `ws:*` pages use one component. Top to bottom:

1. Mono kind eyebrow (`WORKSPACE`) + 900-weight title + status pill.
2. **Three stat tiles**: mono label, big value, one-line sub, value colour carrying meaning
   (forest good, amber needs-you, ink neutral).
3. **Tab row** (per page, §5–§8).
4. **Row list** for the active tab. Three row types:
   - `chip` — name, sub, and a state pill on the right (`Live` / `Core` / `Gap` / `Auto`).
   - `val` — name, sub, and a mono value on the right.
   - `tg` — name, sub, and a **toggle** whose flip writes immediately and toasts what changed.
   Rows are clickable where a detail exists (senders, sources, people); inert rows must not
   look clickable.
5. **Add button**, label per tab (§11 table) — opens the right drawer, never inline.
6. **✦ Ada note**: one derived observation plus one action button that actually performs it
   (e.g. "Change it to Member"). The note must be derived from the page's own data; a generic
   sentence is a defect.
7. Mono record line (the underlying id) at the foot.

---

## 5 · Business core (`ws:core`)

**Stats:** `FACTS SHE KNOWS 14 · all verified by you` (forest) ·
`GAPS 2 · she will not invent them` (amber) · `LAST TOUCHED 6d · financing terms`.

**Tabs:** What she knows · Gaps · Who you are · Where it comes from.

- **What she knows** — fact rows: name + the value she quotes + `Core` pill. Each row opens an
  edit drawer (same shape as add, pre-filled). Add label: *"Add something she should know."*
- **Gaps** — question + how often it was asked + how she currently behaves
  (`Insurance list · Asked 9 times this month — she deflects every one`), `Gap` pill amber.
  Add label: *"Answer a gap now."* Answering a gap **converts** it to a fact: the gap row
  disappears, the facts count rises, the event lands on the workspace timeline.
- **Who you are** — identity rows (business, size/founded, what you sell, who you want).
  Editable; this is the same data onboarding's read-back wrote, and the ICP shown here is the
  same object the Lead finder's brief edits. One source, two doors.
- **Where it comes from** — knowledge sources: name, cadence and yield
  (`brightsmile.com · Read weekly · 9 pages · last Tuesday`), `Live` for re-read sources,
  `Core` for uploads. Add label: *"Add a knowledge source."* Row opens a source drawer:
  what was read, when, how many facts came from it, re-read now, remove.

**Add-fact drawer** (2 steps): *"What is the question people ask?"* (`THE QUESTION`,
placeholder "Do you take my insurance?") → *"And what should she answer? Say it the way you
would say it."* (`THE ANSWER`). Completion: `Teach her` → toast "She knows it now."

**Add-field drawer** (2 steps, new): *"Name the thing. She quotes it exactly as you write it,
and never guesses around it."* (`THE FIELD`) → *"What goes in it?"* (`THE VALUE`).
Completion: `Save the field`.

**Add-answer drawer** (2 steps, new): *"Which question is this for? She matches on meaning,
not wording."* → *"Say it the way you would say it out loud."* Completion: `Teach her`.

**Add-source drawer** (2 steps): a **choice step** — `A website` (read weekly, whole site) /
`A document` (PDF, Word, deck) / `Typed by you` — then the address-or-file step
(*"I re-read a website weekly; a file only when you replace it."*).
Completion: `Start reading it` → toast naming the queue ("Reading started — 9 pages queued").

---

## 6 · Senders (`ws:senders`)

**Stats:** `EMAIL DOMAINS 2 · both authenticated` · `NUMBERS 1 · local Austin area code` ·
`WARM-UP 82% · full volume in 4 days` (amber while warming).

**Tabs:** Email · Numbers · Health.

- **Email** — one row per sender with its authentication summary; a `val` row for reply-to
  (*"Goes to your shared inbox, not Ada"*). Rows open the **sender drawer**.
- **Numbers** — the number with what it carries (`SMS and voice · Austin local`), A2P
  registration state, and a `tg` for voice.
- **Health** — bounce rate, spam complaints, daily ceiling, plus the ruling toggle
  *"Pause if bounces exceed 2% — she stops rather than burn the domain."*

**Sender drawer** (right side, per sender): label `EMAIL SENDER` / `NUMBER`, the address or
number as title, three stats (email: sent 30d / bounces / complaints · number: sent /
delivered / replies), the **warm-up block** when warming (percentage + *"Capped at 120 a day
until it reaches 100%"*), an **AUTHENTICATION** block (SPF / DKIM / DMARC with pass-fail
chips) or **REGISTRATION** for numbers (A2P brand, A2P campaign, caller ID), three actions
(send a test, change the daily cap, remove/release — destructive in red), and the ✦ note.

**Add email sender** (3 steps): address (*"Use a real mailbox you can read — replies go
there."*) → **DNS step** rendering the actual records on a dark mono block with a live
`status waiting for both records` line (*"I check every few minutes until they pass."*) →
warm-up choice (`Careful` 40/day 3 weeks · `Standard` 120/day 10 days, recommended ·
`Fast` 300/day, higher bounce risk). Completion: `Finish` → "Sender added — checking DNS."

**Add a number** (3 steps): area (*"Local numbers get answered more often."*) → what it
carries (`SMS only` / `SMS and voice`) → A2P filing block (*"takes about a day. I file it with
your business details — nothing for you to do."*). Completion: `Get the number` →
"Number reserved · A2P filed."

One identity per workspace per channel stays the shipped ruling; the surface must keep saying
so where it applies.

---

## 7 · Team and roles (`ws:team`)

**Stats:** `PEOPLE 2 · plus Ada` · `OWNERS 1 · you` · `PENDING INVITES 0 · nobody waiting`.

**Tabs:** People · What roles can do.

- **People** — one row per human with role and what that role means in plain words
  (`Front desk · Admin · campaigns and inbox, no billing`), plus **Ada as a row**
  (`Agent · acts inside your guardrails`, `Auto` pill) — she is a team member, not a feature.
- **What roles can do** — Owner / Admin / Member / Viewer, each with its real scope sentence.

**Invite drawer** (2 steps, new — this was missing from the proto too): *"Their work email.
They set their own password — you never see it."* (`EMAIL`) → role choice: `Admin`
(everything except billing and deleting the workspace) / `Member` (works the inbox, runs
campaigns, cannot change guardrails) / `Viewer` (reads everything, sends nothing).
Completion: `Send the invite` → "Invite sent — it expires in seven days."

**States this must also cover** (all real, none decorative): pending invite row with
`Pending` pill + resend + revoke; invite expired; a person's role changed (with who changed
it and when on the timeline); removing a person, with the honest consequence line (their
assigned threads return to the queue); the last owner cannot be removed or demoted.

---

## 8 · Guardrails (`ws:guard`)

**Stats:** `LIMITS ON 7 · workspace-wide` · `CAMPAIGNS INHERITING 4 · all of them` ·
`OVERRIDES 1 · lapsed revival, SMS cap` (amber).

**Tabs:** Sending limits · What she may say · Quiet hours · Campaign overrides.

Sending limits are `tg` + `val` rows (daily email ceiling, daily SMS ceiling, max touches per
contact, honest suppression, weekend sends, new senders need a look). Caps are **typed
recessed wells**, not steppers (Q-081 closure, DEC-133).

The overrides tab is the important one: it names each campaign that departs from the
workspace default and by how much, and links to that campaign's settings. A workspace default
that a campaign silently ignores is the class of bug B7 already fixed once — the overrides tab
is what keeps it visible.

---

## 9 · Credits and usage (surface `credits`)

The build's version is a plain table; the design is a dark hero plus three tabs. Adopt the
design, and gate the numbers per field (§9.3) — the answer to "the design is dishonest" is
never "ship a worse design", it is "render only what is true and say what is missing."

### 9.1 Hero (dark, `linear-gradient(150deg,#0C2A1B,#0A1524 66%,#0A0F14)`, radius 22)

- `CREDITS LEFT` mono eyebrow · balance at 56px/900 in white · runway sentence:
  *"About N days at this month's pace. Ada slows non-urgent sends before you run dry, she does
  not stop."*
- Right column: a thin progress bar with `N% of your monthly allowance left`, and the
  **Top up** button — the one place the signature gradient is allowed on this page.
- Four tiles under it: `USED THIS MONTH` · `INCLUDED MONTHLY` · `BURN` · `RUNS OUT`.

### 9.2 Tabs

- **Where they go** — one row per spend kind (email sends, SMS sends, enrichment, call
  minutes, Ada drafting) with a tinted icon, what happened in plain words
  (*"928 sent across 4 campaigns"*), a proportional bar, and the credit figure — `free` where
  it is genuinely free. Rows drill into the ledger filtered to that kind.
- **What things cost** — the price list from `CreditPrice`, each with its rule stated:
  an email 1 (*"includes the writing. Bounces are not charged."*), an SMS 3 (*"per segment.
  She keeps messages inside one."*), a call minute 8, enriching a contact 4 (*"charged once
  per contact, ever"*), an audience sync 20, **anything Ada writes 0** (*"drafting,
  classifying and deciding are free"*). Never hard-coded — always the effective-dated row.
- **Top-ups** — burn rate, runs-out, credits bought this month; the **auto top-up** toggle
  (*"Adds 2,000 credits when you drop below 500"* / off: *"Ada will warn you instead"*);
  and the invoice list with per-row receipts.

### 9.3 Per-field honesty gate (the reconciliation B7 was right to insist on)

| Field | Source | If the source does not exist yet |
|---|---|---|
| Balance | `CreditLedger` sum | always available |
| Where they go (per kind) | ledger rows by kind | show only kinds that write to the ledger; state plainly that the others are not metered yet — do not draw a zero bar as if it were measured |
| What things cost | `CreditPrice` (effective-dated) | the surface cannot exist without it; render prices only |
| Included monthly / % of allowance | plan entitlement (B9 tiers) | omit the bar and the tile rather than invent an allowance |
| Burn / Runs out / runway | ≥14 days of ledger history | omit; a projection with no history is a fabrication |
| Auto top-up + invoices | billing (Stripe) | render visibly deferred with plain coming-soon copy and file the Q |

**Buy flow** (3 steps, right drawer): pack choice (2,000/$40 · 5,000/$90 · 10,000/$180 with
`best rate` on the last, each showing per-1,000 price and *"about N days of sending"*) →
confirm (credits, price, *"Takes you to N credits"*, change card) → done (*"Receipt emailed.
Ada has already resumed anything she was pacing."*). Note on the flow:
*"Credits never expire. Your plan, card and invoices live in the account area — this workspace
only spends."*

---

## 10 · Integrations

Out of scope for the rebuild beyond the hub row; the B8 surface stands. One correction rides
here: BuyerPing leaves the integrations registry (Addendum 5 §2) — it is a tier, not a
connection.

---

## 11 · Interaction inventory (nothing inert)

| Tab | Add label | Opens | Writes |
|---|---|---|---|
| core / facts | Add something she should know | add-fact | core fact + timeline event |
| core / gaps | Answer a gap now | add-fact, pre-filled | fact created, gap resolved |
| core / who | Add a field | add-field | identity field (shared with ICP) |
| core / sources | Add a knowledge source | add-source | source + ingest job |
| senders / email | Add an email sender | add-sender(email) | sender + DNS check job |
| senders / num | Add a number | add-sender(num) | number reservation + A2P filing |
| team / people | Invite someone | add-person | invite + email, pending row |
| guard / * | — | inline toggles and wells | guardrail write, toast naming the change |
| credits | Top up | buy flow | `CreditLedger` credit + receipt |

Plus: every `tg` writes on flip (no save button); every row that opens a drawer must resolve
its own data (see the Lead-finder drawer lesson — a drawer may read only fields its row
carries); every destructive action states its consequence before it runs.

---

## 12 · Acceptance criteria

1. Every add label in §11 opens the **right-hand drawer** — no inline forms, no modals.
2. Answering a gap removes the gap, creates the fact, and both counts change without a reload.
3. A knowledge source added here produces a real ingest job whose yield is visible on the row.
4. A number can be added and shows its A2P state; an email sender shows live DNS check state.
5. Invite: sends, appears as a pending row, can be resent and revoked; the last owner cannot
   be removed or demoted; role changes land on the timeline with actor and time.
6. Guardrail toggles and caps write immediately, and every campaign override is listed.
7. Credits renders the hero and three tabs; every number either has a source or is absent with
   a stated reason (§9.3) — no invented allowance, burn or runway.
8. Prices come from `CreditPrice`; no per-action price is hard-coded anywhere in the UI.
9. Every drawer and popover dims the page behind it and closes on scrim click.
10. Inputs are recessed wells; cards carry two-layer elevation; no hard grey drop shadows.
11. Fidelity frames from Bright Smile Dental for: hub, core (4 tabs), each add drawer, sender
    drawer, invite drawer, team, guardrails (2 tabs), credits (3 tabs), buy flow (3 steps).

---

## 13 · Questions to file

- Does answering a gap notify anyone (front desk) or just Ada?
- Source re-read cadence: fixed weekly, or per-source?
- Number release: immediate or end-of-cycle, and what happens to threads on it?
- Auto top-up ceiling — is there a monthly cap the owner sets?
- Whether removing a person reassigns their threads automatically or queues them.
- Whether workspace guardrail changes apply to live campaigns immediately or at next step
  (Q-109 already open — this surface is where the answer becomes visible).

---

## 14 · Wave placement

**`B7.5 · Settings & Business core, second pass` — recommended next, before B6.5.** Reasons:
the gaps here **block real work** (a user cannot teach Ada a fact, answer a gap, add a number,
or invite a colleague), while the Lead-finder problem is a surface that misdescribes; and this
unit establishes the drawer, well, elevation and scrim patterns that B6.5 then follows rather
than inventing in parallel.

Revised order: **B7.5 → B6.5 → B10 → B10.5.**

Dependencies: ingest spine for sources (shipped — onboarding's "tell her instead" uses it);
DNS check + A2P filing (shipped in senders/voice); invites (needs the invite model — check and
file if absent); `CreditPrice` (shipped); plan entitlement for the allowance line (B9);
send metering for the usage tab (**not shipped — file it as its own unit**).

# SURFACE SPEC — Lead finder & the intent core

**Status:** owner-locked 2026-08-31. Pixel truth: `prototypes/Console Bold.dc.html`
(dock item 4). Reads with `ADDENDUM_5_INTENT_CORE.md` — that file carries the rulings, this
one carries the build. Where B6's shipped surface disagrees with this spec, this spec wins.

---

## 1 · Why this exists, and what it replaces

B6 shipped a lead finder built on an assumption that is now wrong: that the user connects a
data provider. Three defects follow from it and are being fixed here, not patched:

1. `provider not connected` was shown to the **user**. It is an operator condition — the
   platform holds the key (Addendum 5 §1). Nothing about the vendor reaches the UI.
2. Licensed-supply rows (movers, life events, public dissatisfaction) rendered with no tier
   gate. Paid supply must produce **no rows at all** until the tier is on.
3. The surface was a search box. It is a **standing watch**: signals arrive on their own; the
   user decides who to reach; a credit is spent only to reveal contact details.

The engine is ours and always core; **BuyerPing is the name of the paid signal tier**, never
an integration and never a connect step.

---

## 2 · Wave split and sequencing (recommendation)

**Insert `B6.5 · Lead finder re-skin` next — before B10.** Rationale: a shipped surface that
misdescribes the product is worse than a missing one, the work is mostly IA + registries over
data that already exists, and landing the IA first de-risks the engine wave (the engine then
fills a shape that is already reviewed).

| Unit | Contents | Depends on |
|---|---|---|
| **B6.5 · Lead finder re-skin** | The whole IA in §4–§8 on **existing** data only: brief card, grouped tabs, feed grouped by recency, the pool with its **ALREADY YOURS band real**, watch panel with **core signal types only**, lead drawer contract, Ada-bar context, scrim behaviour, all honest-absence states. Paid types render as not-watching-yet with counts marked as estimates. | shipped: `/agents`, contacts, events, `icpProfile` (B9), `CreditPrice`, plan tiers editor (B9) |
| **B10** (agency suite) | unchanged, as already planned | — |
| **B10.5 · Intent core** | signal shape + first-party emitter, own-book signal derivation, entity resolution, suppression, decay, basis rails at the send/dial boundary, row origins, BuyerPing tier entitlement + real gating, provider match counts for pool bands | B6.5, B9 tiers, event bus |
| **later, filed** | licensed consumer feeds; org collectors (hiring, Places velocity, permits, news); extraction of supply behind a service boundary | B10.5 |

B6.5 must not invent a signal it cannot derive. Of the three core types in §3, all three are
derivable from shipped rows — that is why they are core.

---

## 3 · Data model

### 3.1 Signal (one shape, all suppliers — Addendum 5 §3)

```
subject      resolved entity (contact and/or company)
type         registry key
basis        first_party | public_record | licensed | inferred
occurredAt   timestamp (drives decay)
receipt      the factual sentence shown to the user, composed from the signal's own data
supplier     internal (never surfaced): first_party | provider | collector
```

Ranking never reads `supplier`. Adding a supplier costs zero UI.

### 3.2 Signal-type registry (`SIGNAL_META`, beside `GOAL_META`)

Per type: `key`, `label`, `why` (one line, user-facing), `tier` (`core` | `bp`),
`shapes` (`company` | `local_business` | `consumer`), `verticals` (or `*`), `basis`,
`weight`, `decay`, `receiptTemplate`, `estimate` (the honest "would find" line).

Shipped set for a consumer-shape dental workspace (the canon demo):

| key | label | tier | basis | derived from |
|---|---|---|---|---|
| `site` | Reading your pages | core | first_party | widget sessions, form submissions, chats |
| `quiet` | Patients who went quiet | core | first_party | last visit / last message age |
| `asked` | Asked and never booked | core | first_party | enquiry with no booking outcome |
| `moved` | Just moved into your area | **bp** | licensed | mover feed |
| `life` | Life events you serve | **bp** | licensed | life-event feed |
| `unhappy` | Unhappy with their practice | **bp** | public_record | review feed near you |

Company-shape equivalents (`hiring`, `opening`, `ads`, `reviews` + locked `funding`,
`permits`, `news`) live in the same registry keyed by shape. **A hard-coded B2B noun in a
shared surface is a review defect** (standing industry ruling).

### 3.3 Target shape

`icpProfile.targetShape` ∈ `company` | `local_business` | `consumer`, written at onboarding.
It selects registry rows, the noun in every count line, and Direct-search filters. Consumer
shape: person-level signals only, first-party plus licensed consumer feeds.

### 3.4 Pool bands (All who fit)

Bands are computed, not stored. Cheapest first, always:

| band | definition | reveal cost |
|---|---|---|
| `yours` — ALREADY YOURS | fits the brief **and** contact details already on file | FREE |
| `strong` — STRONG FIT · 90+ | fit ≥ 90, details not held | 1 CR each |
| `good` — GOOD FIT · 80–89 | fit 80–89 | 1 CR each |
| `try` — WORTH A TRY · 70–79 | fit 70–79 | 1 CR each |

Below 70 is not offered. `yours` is first because it is free and because working it before
buying anything is the honest advice.

---

## 4 · Page IA

Order, top to bottom:

1. **Topbar** (shared): eyebrow `LEAD FINDER · WATCHING` + title from the shape registry
   (`Who's looking for a dentist` / `Who's in the market`).
2. **Value sub-line**, 13px muted, max 660px, 12px below the title:
   *"She watches for the moment someone needs what you sell, then hands you the reason. You
   only spend a credit when you want their details."*
3. **Brief card** — one line, no eyebrow: the brief sentence, a mono chip
   `WATCHING SINCE <date>` that folds the provenance line open, and `Edit brief`.
   Provenance (folded): *"Fit scored from your last 300 patients · watching new arrivals,
   life events and nearby dissatisfaction"* — composed from the real scoring inputs.
   `What she watches` button sits in this card.
4. **Mode row**, grouped and labelled:
   `✦ ADA FINDS` → `In the market · N` (with 🔥 when N-today > 0) · `All who fit · N`
   │ `YOU FILTER` → `Direct search`.
   Group labels, not per-pill labels: pills stay short, and the row reads as two territories.
   The 🔥 is present only when something fired today.
5. **Active-filter chip** (`Signal: <label> ✕`) and the mono count `N WAITING ON YOU`.
6. **Mode body** (§5 / §6 / §7).
7. **Ada bar**, pinned (Addendum 5 §6c).

---

## 5 · Mode: In the market (default)

Grouped by recency, because signals are news:

- Dividers `TODAY · N` (amber dot, 2.4s pulse) and `EARLIER THIS WEEK · N`. Groups with no
  rows do not render.
- **Row anatomy**: left spine (amber today / mint earlier) · avatar with initials on a tint ·
  name · fit pill · **the receipt in ink** (the evidence, e.g. *"Moved into Mueller six days
  ago — 2 miles from you"*) · muted `about` · mono `source` tag · **basis chip** stating the
  channel permission (`email ok · no call consent` amber / `any channel she used` mint) ·
  action column: `Reveal · 1 cr` + `Not for me`, becoming `→ Campaign` + `Add to a list`
  once revealed, with the email and phone chips shown.
- **Whole row opens the lead drawer**; action controls `stopPropagation`.
- **Foot lines** (quiet, muted, never modals): suppression — *"14 held back for you — 9 are
  already your patients, 3 asked not to be contacted, 2 are mid-treatment"* with `Show them`;
  and the tier tease — *"N more kinds of moment could be watching for you — …"* with
  `See what they are`, which opens the watch panel **on its BuyerPing tab**.
- **Empty states**: filters exclude everything → *"Nothing matches those filters"* + widen
  advice. Nothing has fired yet → *"Nothing has fired yet"* + what is being watched, phrased
  so the user does not read it as broken. Collection down → *"Signals are paused"* +
  "nothing is lost".

---

## 6 · Mode: All who fit — the standing pool

Not a list: a **pool of segments, volume and cost**. 4,180 people cannot be browsed row by
row, so the surface is built around bands.

> **Amended B6.6** (prototype wins over spec prose). The pool header's sentence is
> *"<noun> **fit your brief**"* — the prototype's words. The build had shipped *"<noun> you
> can **work today**"*, which claims a timeliness the pool does not have: this mode is the
> standing market, whether or not anything is happening. "Today" belongs to the market feed,
> and having both surfaces say it made them indistinguishable.

1. **Pool header**, one row: big pool number + unit noun from the shape registry, hairline
   divider, then two fold chips — `HOW THIS IS SCORED` (grey) and `N HELD BACK` (amber).
   Only one is open at a time; both closed by default. Their bodies:
   - scored: *"Scored against your last 300 patients — implants, crowns and whitening, within
     25 miles of Austin. The whole market that fits you, whether or not anything is happening
     yet."*
   - held back: the suppression breakdown, same numbers as the feed foot (one source).
2. **Four band cards** (§3.4), selectable, cheapest first. Each: mono tag · **quiet mono cost
   label** (`FREE` forest / `1 CR` faint — never a chip; cost must not shout) · count in
   900-weight · a short sub of a few words. Selected = mint fill + mint hairline.
3. **Bulk bar** — states the credit arithmetic out loud:
   - free band: *"All 312 already have details"* / *"You already hold their details and
     consent."* → `Add 312 to a campaign`
   - paid band: *"Revealing all 240 costs 240 credits"* / *"Or reveal a few from the list
     first."* → `Reveal and add 240 · 240 cr`
   - plus `Save as a list` (secondary, always).
   Paid bulk reveals **queue** and draw down as credits allow; a bulk action must never spend
   more credits than the balance without saying so.
4. **Band divider** — `<BAND> · N · <definition>` + `Ranked by fit`.
5. **Rows** — avatar · masked identity for unrevealed licensed rows (`Household · Mueller,
   78723` — never a name before reveal) · fit pill · mono source · **why-it-fits chips** (the
   matched facts: *2 miles away · owns the home · no dentist on record*) · state
   (`Details on file` forest / `No signal yet` muted) · action (`→ Campaign` when held,
   `Reveal · 1 cr` when not). Whole row opens the drawer.
6. **Honest paging** — *"Showing the top N of M by fit."* + `Show more`.

**B6.5 scope note:** the `yours` band is fully real from shipped data. The three paid bands
render with counts explicitly marked as estimates until B10.5 supplies provider counts — an
estimate must be labelled as one, never presented as a live count.

---

## 7 · Mode: Direct search

Renamed from "Search yourself". Filter-first search over the provider, filters adapting to
target shape (industry/size/funding for company; radius/category/rating for local;
contacts-scoped or hidden for consumer). Selection → bulk reveal with the same credit math.

**States:** results (count + "revealing costs 1 credit each") · **platform key absent →
"Search is temporarily unavailable" + "nothing for you to fix — your watch is still running"**
(never a vendor name, never a connect affordance) · saved-search deferred per its filed Q.

---

## 8 · The watch panel ("What she watches")

A popover anchored to its button in the brief card, `max-height:560px`, internally scrolling.

- **Scrim required**: `position:fixed; inset:0; rgba(16,22,19,.26)`, z-index one below the
  panel, click-to-close. Every popover and sheet in the console follows this — an open
  overlay must visibly recede the page behind it.
- **Header**: mono `WHAT SHE WATCHES` + a 900-weight title.

> **Amended B6.6** (prototype wins over spec prose). "From the shape registry" was read as
> the PAGE question, so the panel printed `Who's in the market` under a header that already
> said `WHAT SHE WATCHES` and read as a repeat. The panel has its OWN registry title —
> `People near you, worth reaching` for a local or consumer brief — because it names the
> standing brief, not today's news.
- **Two tabs**: `Watching · N` and `BuyerPing` (`BuyerPing · on` when enabled). The tier is
  reachable in one tap from the feed foot, so it is never buried.
- **Watching tab**: signal types with tier badge (`INCLUDED` / `BUYERPING`) and live count,
  **tap to filter** (this is where signal filtering lives — not the mode row) ·
  `WHEN IT FIRED` and `FIT AGAINST YOUR BRIEF` as pill rows, each option showing the count it
  would yield · `WORDS AND PLACES` topic chips + `+ add` · `HOW SHE MAY REACH THEM` (the basis
  sentence, §9).
- **BuyerPing tab** — copy is the original console's, verbatim: status `Adds real intent`,
  three what-it-does lines (fit works without it / with it she knows who is moving now / the
  difference is timing), three stats (`FIT MATCHING Included` · `INTENT SIGNALS Locked` ·
  `COST AFTER 2 credits per lead enriched`), swapping to the connected set when on. Then
  not-watching-yet types with their estimates, the toggle, and the price as
  `$49 / mo · PROPOSED` with *"Price comes from your plan, not from this page"* (D1/D2).
  Foot: *"Counts are what she can see without contacting anyone. Nothing is watched, and
  nobody is contacted, until you switch it on."*
- Enabling the tier from here is an **entitlement write**, subject to the same plan rules as
  any add-on; it never bypasses billing.

---

## 9 · Lawful basis binds channels (Addendum 5 §4)

- Each signal carries its basis; each channel declares the basis it requires.
- The send/dial boundary refuses the combination, typed, as it refuses DNC today.
- Consumer canon sentence: *"Movers and life events are licensed data: she may email them and
  put them in ads, but she may not call or text until they have said yes. Your own records
  and your own visitors can be replied to in any channel they used."*
- Region on the workspace tightens the matrix without a code change.
- **No surface may present a signal as actionable through a channel its basis forbids.**

---

## 10 · Lead drawer contract

The bug this spec fixes: the drawer read fields (`sub`, `signal`, `SIG[s]`) that rows did not
carry, and threw. Rule: **the drawer may read only fields the row itself carries**, and it
must resolve rows from **every** list that can open it (feed and pool alike).

Contents, in order: name + fit + source · **what she saw** (the receipt) · **why it scored
what it scored** (the matched ICP facts, named) · **the basis line** for this row · **reveal
state** and what a reveal costs · three stat tiles (Fit / Where it came from / Reveal) ·
actions that differ by state — unrevealed: `Reveal · 1 credit`, `Not a fit — hide it`;
revealed: `Send straight to a campaign`, `Add to a list`, `Not a fit — hide it`.
`Not a fit` teaches the brief (it is a scoring signal, not just a hide).

---

## 11 · Interaction inventory (every control writes something real)

| Control | Writes |
|---|---|
| Mode pills | view state only |
| Signal type row (panel) | filter state; chip appears in the mode row |
| When / Fit pills (panel) | filter state, counts recomputed |
| Topic `+ add` | watch-topic row on the workspace |
| `Edit brief` | opens the ICP editor (shared with onboarding's audience step) |
| Row click | opens the lead drawer |
| `Reveal · 1 cr` | provider resolve + `CreditLedger` debit + contact upsert + timeline event |
| `Not for me` / `Not a fit` | dismissal marker (suppresses re-surfacing) + scoring feedback |
| `→ Campaign` | enrolment through the shipped create path — no parallel schema |
| `Add to a list` / `Save as a list` | list write |
| Bulk reveal | queued reveals, credit-bounded, one event per reveal |
| `Turn on BuyerPing` | entitlement write, billed with the plan |
| `Show them` (held back) | suppression detail |
| Ada bar | Addendum 5 §6c table |

No control may be inert. A dead control is a review defect (standing rule).

---

## 12 · Acceptance criteria

1. With the tier off, **no licensed-supply row exists anywhere** in the response, not merely
   hidden in the UI.
2. With the platform provider key absent, no surface names a vendor or asks the user to
   connect anything; Direct search shows the temporarily-unavailable state.
3. Every row in every mode opens the drawer without error; the drawer renders only from that
   row's own fields.
4. Every count shown (feed, panel, bands, filter options) is either server-derived or
   labelled an estimate.
5. Reveal debits exactly one credit at the price in `CreditPrice`, writes the contact, and
   emits one timeline event; a failed reveal debits nothing.
6. A basis-forbidden channel is refused at the boundary, with the typed refusal visible in
   the UI (e.g. Ada-call blocked on a licensed row).
7. Suppression counts in the feed foot and the pool header come from **one** source.
8. Opening any popover dims the page behind it and closes on scrim click.
9. Nouns in every user-facing string come from the shape/vertical registries; the jargon lint
   and a new noun check pass.
10. Fidelity frames captured from a plausible business (Bright Smile Dental), gated, reviewed.

---

## 13 · Questions to file

- Signal weights and decay curves per type (defaults are proposals, not canon).
- Sweep/collection cadence per supplier; cron readiness.
- Per-region basis matrix (which channels each basis permits, by jurisdiction).
- Whether the intent *number* is ever shown outside the row drawer (currently: no).
- Saved searches in Direct search (deferred in B6 — still open).
- Whether `Not a fit` should feed the ICP model automatically or require confirmation.

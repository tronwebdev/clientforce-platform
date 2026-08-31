# ADDENDUM 5 — Intent as core · Apollo as platform infrastructure · Lead finder consolidation

**Owner rulings, 2026-08-31.** Binds all future lead-finder, intent and prospecting work.
Supersedes the B6 dispatch's Rulings 1–3 where they conflict. Nothing here re-opens a
merged wave; the copy corrections in §1 and §6 are small and ride the next wave, the
engine in §3–§5 is its own unit (see §8).

---

## 1 · Apollo is platform infrastructure, not a user connection

**Ruling.** The lead-data provider is held by the platform: one platform-level key, one
vendor relationship, one bill that Clientforce pays. The user never connects anything,
never authenticates a provider, and never sees the vendor's name anywhere in the product.
They pay in credits.

Consequences, all mandatory:

- **`provider not connected` is an operator condition, not a user-facing state.** Any copy
  that asks the user to connect a provider, or that names one, is a defect. When the
  platform key is absent, the surface says the capability is temporarily unavailable — the
  user has nothing to fix.
- Reveal and enrichment prices stay **effective-dated `CreditPrice` rows**, admin-editable
  (D1). The credit price must cover our per-record cost; no per-action price is ever
  hard-coded in UI.
- The provider stays behind the **provider-agnostic search interface** already shipped in
  B6. Swapping or adding a provider is an adapter change with zero UI impact.

---

## 2 · One intent engine, always core. "BuyerPing" is the name of the paid tier.

**Ruling.** There is no BuyerPing *integration*, and no second product to connect. The
intent engine is built inside Clientforce and is core to every workspace. "BuyerPing" is
retained as the **brand name of the paid signal tier** — a capability a workspace buys more
of, never a connection it makes.

The word **"integration" must not appear** in any intent surface, and BuyerPing's entry
leaves the integrations registry.

**Core — every workspace, no add-on, no connect step:**

- The engine itself: ingestion, entity resolution, recency decay, fit × intent ranking,
  reason receipts, the lawful-basis rails (§4).
- **First-party signals** (free, real-time, highest quality): site-agent chats, form
  submissions, email/SMS replies, proposal views, calls, bookings, repeat site visits.
- **Own-book signals**: went quiet, never bought, renewal due, lapsed, lost deal reopened.
- **Watch topics** as plain configuration (competitors, service areas, technologies,
  interests — vocabulary per business shape and vertical, from the registries).

**BuyerPing tier — paid supply on the same engine:**

- Licensed and collected signals that cost real money per record: consumer life events and
  movers, org-level hiring / funding / tech change, review velocity, permits, news,
  third-party surging intent.
- Metered through `CreditPrice` like everything else; tier entitlement is agency-level
  data (D2), never hard-coded.

**What a workspace without the tier sees:** the same lead list and the same engine, plus one
honest row at the foot of the list naming the locked signal *types* and their real count.
Never a fake row, never a vendor name, never a connect button.

---

## 3 · One signal shape, suppliers as adapters (keep the seam)

Every signal — first-party, own-book, licensed, collected — enters through **one typed
shape**, and the ranking layer never learns which supplier produced it:

```
subject      → resolved entity (contact and/or company)
type         → registry key (e.g. hiring, moved_in, replied, funding, review_spike)
basis        → lawful basis + provenance (first_party | public_record | licensed | inferred)
occurredAt   → timestamp (drives decay)
receipt      → the factual sentence shown to the user, composed from the signal's own data
```

Suppliers are adapters behind that shape: the first-party emitter (our own event bus) ships
now; licensed feeds and collectors arrive later as further adapters. Adding a supplier costs
**zero UI**.

**All of it is built inside Clientforce.** There is no second codebase, no external service,
no API between two products — the adapters are internal modules. "BuyerPing" names the paid
tier and nothing else. The typed shape exists for coherence (one ranking layer, one receipt
vocabulary, cheap addition of new supply), not to hold a product boundary open.

**Signal taxonomy is registry data, not code** (standing industry ruling): each type declares
its applicable business shapes and verticals, weight, decay curve, basis, and receipt
template with vertical vocabulary ("hiring a hygienist" / "just raised a Series A" / "asked
about pricing twice this week"). Adding an industry is registry rows.

---

## 4 · Lawful basis binds channels, not signals

**Ruling.** Sourcing a signal and acting on it are separate permissions. Consumer signals
(movers, life events) are legitimate to hold; what may be *done* with them is constrained
per channel and per region.

- Every signal carries its **basis** (§3).
- Every channel declares the **basis it requires**: Ada calls require explicit call consent
  (already shipped — unknown means no); SMS requires consent; email tolerates opt-out; ads
  and direct mail require neither.
- The **send/dial boundary refuses the combination, typed**, exactly as it refuses DNC today.
  A moved-in signal may drive an email or an ad audience and still be blocked from an Ada
  call — and that decision is data, not a hard-coded rule.
- **Region sits on the workspace**, so a stricter jurisdiction tightens the rails without a
  code change.

No intent surface may present a signal as actionable through a channel its basis does not
permit.

---

## 5 · Intent-led discovery: org-first, person-second, one list

Discovery is **a new row origin inside the existing Ada mode**, not a new mode or surface.

The loop:

1. A signal fires on an **organization** (hiring, funding, tech change, new location,
   permit, review velocity, news) — or, for consumer shapes, on a **person** through a
   first-party or licensed consumer signal.
2. **Entity resolution** attaches it to one subject across sources; **suppression** removes
   existing customers, open deals, DNC.
3. The **ICP filters it** — wrong industry, size or area never reaches the user.
4. Only then does the provider **resolve the actual people** who match the role sold to.
   The credit charge happens at **reveal**, on a row whose reason is already visible.
5. **Fit × intent × reachability** ranks the result; every row carries its receipt.

Fit and intent stay **separately labeled everywhere** — never merged into one "score."

---

## 6 · Lead finder UI — rebuilt as a standing watch

**Canon: `prototypes/Lead Finder.dc.html`** (2026-08-31). This supersedes the shipped B6
surface, whose search-first framing no longer matches what the product does. The three old
modes and the right-hand filter column are retired.

**The premise the UI must carry:** the brief written at setup is a *standing watch*. Buying
moments arrive on their own, each with its evidence; contact details are resolved only when
the user asks. It is not a search page.

**Anatomy, top to bottom:**

1. **Title** — shape-derived, from the registry: `Who's looking for a dentist` for a
   consumer-shape workspace, `Who's in the market` for company-shape. Never a fixed string.
2. **Brief card** (full width) — the brief in one plain sentence, its provenance ("Fit scored
   from your last 300 patients · watching new arrivals, life events and nearby
   dissatisfaction"), `WATCHING SINCE <date>`, and **Edit brief**. Right of the title:
   **What she watches** (opens the sheet, §6.3) and `?`.
3. **Tabs + pickers in one row** — tabs `In the market · N` (default) · `All who fit` ·
   `Search yourself`; then console-style pickers, same vocabulary as the B2 inbox:
   **Signal · N types** (menu: each type with a live count, checkable; below a divider,
   `AVAILABLE TO ADD` listing locked types greyed), **When** (anytime / today / earlier this
   week), **Fit** (any / 80+ / 90+). Every option shows a live count computed against the
   other two filters. **No dead pickers.** Menus anchor to their trigger, never a fixed
   offset. Right-aligned mono: `N WAITING ON YOU`.
4. **The feed, full canvas**, grouped by recency because signals are news: `TODAY · 3`
   (amber pulsing dot) then `EARLIER THIS WEEK · N` (mint dot). 3px left spine per row —
   amber today, mint earlier.
5. **Row** — avatar; name + `NN fit` mint pill; **the receipt in ink** ("Moved into Mueller
   six days ago — 2 miles from you", "Posted two hygienist roles — 3 hours ago"); then a
   muted about-line, a **mono source tag** (`MOVER LIST`, `LIFE EVENT`, `PUBLIC REVIEW`,
   `YOUR SITE`, `JOB POSTING`, `PUBLIC RECORD`, `AD LIBRARY`, `REVIEW FEED`) and a **channel
   chip stating what the basis permits** (`email ok · no call consent` in amber; `any channel
   she used` in mint for first-party). Actions right: **`Reveal · 1 cr`** with **`Not for
   me`** beneath (dismissal is feedback — it teaches the brief); after reveal, contact chips
   appear and the actions become `→ Campaign` / `Add to a list`.
6. **Foot of list** — one quiet line: "14 held back for you — 9 are already your patients, 3
   asked not to be contacted, 2 are mid-treatment" + `Show them`. Transparency about
   suppression, not a nag.
7. **Ada bar** — "Tell her what to watch — 'people who just moved into 78723'".

**6.1 Fit is a number, intent is a reason.** Fit renders as `NN fit`; intent renders as the
receipt. Two competing numbers per row is clutter, and reasons persuade better than scores.
An intent *number* may appear only in a row drawer. Never a merged score.

**6.2 Shape drives every noun.** A consumer-shape workspace's rows are people (movers, life
events, unhappy-with-their-practice, your own visitors); a company-shape workspace's rows are
organizations (hiring, opening, advertising, reviews climbing). Same engine, same anatomy,
registry-supplied vocabulary. **A hard-coded B2B noun in this surface is a review defect** —
as is showing businesses as leads to a workspace that sells to consumers.

**6.3 "What she watches" sheet** (right slide-over, replaces the old right column): `ON NOW`
(each active signal type with a one-line why), `WORDS AND PLACES` (watch topics + add),
`AVAILABLE TO ADD` (locked types, greyed, footed "Available on the BuyerPing tier. Nothing
here is on until you switch it on."), and `HOW SHE MAY REACH THEM` — the basis rails in plain
words ("Movers and life events are licensed data: she may email them and put them in ads, but
she may not call or text until they have said yes. Your own visitors can be replied to in any
channel they used.").

**6.4 States, all three required:** *live*; *watching — nothing fired yet* (the honest day-one
state, which explains itself rather than looking broken: "Your brief is live and four signal
types are being watched…"); *search unavailable* (operator condition per §1 — "Nothing for you
to fix — your watch is still running"). Over-filtering has its own empty state ("Nothing
matches those filters"), distinct from having nothing to show.

**6.5 Direct search (`Search yourself`)** keeps filter-first search over the provider, with
shape-appropriate filters, and never asks the user to connect anything.

---

## 6b · Console-canon revision (2026-08-31) — pixel truth is `prototypes/Console Bold.dc.html`

The Lead finder in Console Bold has been rebuilt to this spec; it supersedes the table above
where they differ. Port from the prototype, not from the table.

- **A value sub-line sits under the page title**, above the brief card: "She watches for the
  moment someone needs what you sell, then hands you the reason. You only spend a credit
  when you want their details."
- **Filters live in the “What she watches” panel, not the tab row.** The row carries only the
  three modes (In the market · N / All who fit / Search yourself), a clearable `Signal: … ✕`
  chip when a signal filter is active, and the waiting count. Inside the panel: signal types
  (tap to filter, each with its tier badge and live count), WHEN IT FIRED, FIT AGAINST YOUR
  BRIEF, WORDS AND PLACES, HOW SHE MAY REACH THEM — every option showing the count it would
  yield.
- **The panel has two tabs: `Watching · N` and `BuyerPing`.** The tier is never buried: the
  feed-foot line ("N more kinds of moment could be watching for you — … · See what they are")
  opens the panel **directly on the BuyerPing tab**.
- **BuyerPing tab copy is the original console's, verbatim** — status "Adds real intent", the
  three what-it-does lines (fit works without it / with it she knows who is moving now / the
  difference is timing), and the three stats (Fit matching Included · Intent signals Locked ·
  Cost after 2 credits per lead enriched), swapping to the connected set when on. Price shown
  as `$49 / mo · PROPOSED` with "Price comes from your plan, not from this page" (D1/D2).
- **Tier gating is real:** core signal types (your site, patients who went quiet, asked and
  never booked) are `INCLUDED` and always on; paid types (movers, life events, public
  dissatisfaction) are `BUYERPING` and **produce no rows at all until the tier is on**. A
  licensed-supply row appearing without the tier is a defect.
- **Lead detail drawer contract:** what she saw (the receipt), why it scored what it scored,
  the channel permission its basis allows, and the reveal state — then actions that differ by
  state (Reveal · 1 credit → then Send to a campaign / Add to a list). Every field must come
  from the row's own data; a drawer that reads a field the row does not carry is the bug this
  revision fixed.

---

## 6c · The Ada bar on the Lead finder

The bar is the same component as everywhere else — only its context changes. On this page it
is the **brief editor and the watch controller**, not a search box.

**Placeholder:** "Tell her what to watch — ‘people who just moved into 78723’" (the example
comes from the workspace's own shape and area registries; a hard-coded B2B example here is a
defect).

**What it must accept, each mapped to a real write:**

| The user says | What happens |
|---|---|
| "watch people who just moved into 78723" | adds a watch topic; the panel's WORDS AND PLACES gains the chip; confirms with the count it would have matched |
| "stop watching Invisalign" | removes the topic, states what stops arriving |
| "only show me 90 and above" / "just today" | sets the fit floor / window — the same state the panel's controls write, so the chip and the panel agree |
| "why is this one here?" (with a row focused) | reads back the row's receipt, its source, and its fit reasons — no new claim, no invented signal |
| "who should I call first?" | ranks the visible rows and names the basis constraint honestly ("none of these may be called yet — they have not said yes; the three from your own records may") |
| "send the top five to a campaign" | opens the campaign create flow pre-seeded with those rows; **reveals nothing** — reveal remains an explicit per-row credit spend |
| "turn on BuyerPing" | opens the panel's BuyerPing tab; never enables a paid tier from a chat line alone |

**Rails, all mandatory:**

- **The bar never reveals contact details and never contacts anyone.** Those stay explicit
  clicks with their price on the control.
- **Every answer carries provenance** — the row's source and the fact it was derived from,
  same standard as the campaign Ada read: derived, read-only, never composed narrative.
- **It refuses honestly** rather than inventing: asking for a signal type the workspace does
  not have on says so and names the tier; asking for people outside the ICP's shape says the
  brief would need changing and offers to change it.
- **Anything it changes is visible in the UI it changed** — a topic added by chat appears as a
  chip; a filter set by chat shows as the chip in the tab row. No invisible state.
- The bar is **not** a second search surface: it never returns a list of its own, it moves the
  one list.

---

## 7 · Onboarding

**Day-zero intent is normal, not impossible.** The brief written during onboarding —
industry, service keywords, radius, size, the role sold to — is by itself sufficient to seed
the outside-signal queries. No workspace history is required. What is absent on day one is
**first-party** intent (no traffic yet), not intent as such.

So the closing step carries an **ICP-derived signal line** — "3 practices within 25 miles are
hiring right now" — gated on the signal layer being live, shown only when a new-demand
audience was picked, and stated without any implied contact ("nobody is contacted until you
say so"). When the signal layer is not live the line is absent; a provider match count is an
acceptable fallback under the same rules (a count, nobody revealed, no vendor named). Where
contacts were imported on the new import step, our own scoring over those real rows is
always honest. Never a fabricated number.

Canon: `prototypes/Business Core Onboarding.dc.html` (updated 2026-08-31 — goal before
audience, multi-select audiences with a primary, conditional contacts import, industry as a
read-back fact with stated provenance, manual "tell her" path with document upload).

---

## 8 · Sequencing

- **B10 (agency suite) ships unchanged.** Nothing here folds into it.
- **§1 and §6 copy corrections** ride the next wave as a small, stated item — the
  user-facing "connect a provider" language is wrong today and cheap to fix.
- **New unit — "Intent core" (proposed B10.5), after B10:** the engine, the signal shape and
  first-party emitter, own-book signals, entity resolution, suppression, decay, the
  lawful-basis rails, row origins in Ada mode, the Signals drawer, locked-types row.
  Ships on real rows only: a workspace with no history shows an honest empty intent tier.
- **Later units, filed not built:** licensed consumer feeds; org-level collectors (hiring
  feeds, Places review velocity, permits, news); the BuyerPing tier's entitlement and
  metering. No unit ever extracts the supply into a separate product or service.

Open questions to file: signal weights and decay curves per type (defaults are proposals);
sweep/collection cadence; per-region basis matrix; whether the intent number is ever shown
outside the row drawer.

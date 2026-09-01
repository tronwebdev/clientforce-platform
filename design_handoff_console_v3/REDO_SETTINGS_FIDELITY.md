# REDO — Settings fidelity pass (B7.6)

**Status:** owner-directed, 2026-08-31. B7.5 shipped the structure but drifted from the
prototype in ways a prose spec couldn't catch. This document is the correction, and it changes
one rule permanently:

> **The prototype outranks the spec prose.** Where `prototypes/Console Bold.dc.html` and any
> `SURFACE_SPEC_*.md` sentence disagree, the prototype wins and the spec line gets amended in
> the same PR. Three of the deviations below exist because the build followed my prose
> faithfully — that is my error, not the build's.

---

## 1 · Verified deviations (owner-reviewed, frame by frame)

### 1.1 Buy credits — `buy-1` (the worst of them)

| Element | Prototype | Build | Fix |
|---|---|---|---|
| Container | **Centered modal**, ~478px wide, over a dimmed page | Full-height right drawer, ~420px, ~450px of dead space below the content | Centered modal. My spec said "right drawer" — wrong; amend §9.3 |
| Eyebrow | `CHOOSE A PACK · 1 OF 2` | `TOP UP` | Prototype's, including the step count in the eyebrow |
| Steps | **2** (choose · confirm) | 3 | 2 |
| Pack row | credits + **price** right-aligned in 900 weight (`$40` / `$90` / `$180`) | credits only — **no price anywhere on a buy screen** | Restore prices |
| Pack sub-line | `$20 per 1,000 · about 10 days of sending` | `Takes you to 4,340` | Restore per-1,000 rate and days-of-sending. Keep the new-balance line only in the confirm step |
| `best rate` chip | mint pill on the 10,000 pack | absent | Restore |
| Footnote | ✳ glyph + bordered well: *"Credits never expire. Your plan, card and invoices live in the account area — this workspace only spends."* | same sentence as loose text, split across two places | One bordered well with the glyph, prototype's copy |
| Primary | `Continue` inside the card, bottom-right | pinned drawer footer with `1 OF 3` | Inside the card |

**A buy screen with no prices is not a fidelity nit — it is the revenue surface of a product
targeting 100 paying accounts.** If pack prices are genuinely not yet configurable data, then the
whole flow is a deferral and must say so; it may not render a priceless picker as if it worked.
State on the PR which it is.

### 1.2 Business core → Where it comes from — `core-sources`

| Element | Prototype | Build | Fix |
|---|---|---|---|
| Row leading icon | 28px tinted rounded tile per source (globe for a site, document for a file) | **absent** | Restore. Check every list row in the unit for the same omission |
| Row sub-line | `Read weekly · 9 pages · last Tuesday` | `Read weekly · 3 facts found` | Include **when it was last read**; yield may follow it |
| Row chevron | none | `›` on every row | Match the prototype |
| Record line | none in this view | raw cuid `cmth1x47v00867d5z8t9sgcap` at 10px | My spec asked for a mono record line; the prototype doesn't carry one here. Drop it from item pages, or render it only where the prototype does |
| Ada note | mint card, no heading, forest button | matches | keep |

---

## 2 · What the build got right — do not "fix" these

- The honesty gate on credits: dropping `INCLUDED MONTHLY` / `BURN` / `RUNS OUT` for
  `USED THIS MONTH` / `ADDED THIS MONTH` plus the stated reason, and
  *"Nothing has drawn down credits this month"* over a fake zero bar.
- Gaps attributed to the campaigns that need them ("2 of your live campaigns need it") — better
  than the prototype's static pair.
- Forest solid Top up with the 34%-white hairline on the dark hero.
- `Member` as the human role word with `AGENT` retained as the stored enum.

---

## 3 · The process fix (this is the real deliverable)

The two diffs above are examples, not the list. **Do an exhaustive pairwise diff of all 21
build/proto pairs in `docs/fidelity/b75/`** and post the results as the PR's first comment,
before writing code. For each pair, one table with a row per deviation:

`element · prototype · build · verdict (fix | adopt-build-with-reason | spec-amend)`

Rules for the verdict column:

- **fix** — default. The prototype is truth.
- **adopt-build-with-reason** — only for an honesty gate (a number with no source), a canon
  rule the prototype itself violates (gradient on a button fill), or a real defect in the
  prototype. Name which of the three.
- **spec-amend** — the deviation exists because a `SURFACE_SPEC_*.md` sentence contradicts the
  prototype. Amend the spec line in the same PR and say which line.

Things a prose spec systematically failed to carry, so look for them specifically in every pair:
**leading icons and their tints · exact sub-line composition and order · presence or absence of
chevrons · container type (modal vs drawer vs inline) · step counts and where the counter lives
· whether a price, rate or date is shown · button placement · empty space** (a drawer holding
modal-sized content is a deviation, not a layout accident).

---

## 4 · Acceptance

1. The 21-pair diff table is posted before any code, with a verdict on every row.
2. Every `fix` row is fixed; every `adopt-build-with-reason` names its category; every
   `spec-amend` amends the spec file in the same PR.
3. The buy flow is a centered 2-step modal with prices, per-1,000 rates, days-of-sending and
   the `best rate` chip — or an honest deferral, stated.
4. No list row in the unit is missing its prototype icon.
5. No raw cuid is rendered to a user anywhere in the unit.
6. Frames re-captured clean-tree through the gate; **the owner will review every pair this
   time**, not a sample.
7. Nothing in §2 regresses.

---

## 5 · Scope and sequencing

**`B7.6 · Settings fidelity pass`** — Settings session, next. It is UI-only: no schema, no
seed, no API changes, so it can run in parallel with B9.5 metering (which owns the charge path
and touches credits *copy* only — coordinate on the credits page: B7.6 owns its layout, B9.5
owns which numbers are real).

Ledger: Settings session's existing block. Same gates as always.

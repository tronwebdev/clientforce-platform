# PLAN — B1 pricing amendment (2026-08-01 cost-model lock, DEC-103)

> Status: **PLAN POSTED** — branch `claude/pricing-amendment-schema-aogxks`.
> A small follow-on to B1 **W2** (the credit-price editor, DEC-080, merged in #97),
> not a new wave and not a seed. `COST_MODEL_AND_PRICING.md` was re-audited and
> **LOCKED by the owner on 2026-08-01**; this PR is the record that makes the
> locked model inheritable by the units that will implement the deferred halves.

## What this PR is

A **record**, not a build. The amendment has four items and exactly one of them
is a "do" verb (cut the DEC entry). The other three are: rates the owner enters
in a shipped editor, a schema change explicitly marked _do not build now_, and a
billing rule whose flow belongs to a future unit. So the deliverable is the
repo's memory of all three, filed where the unit that inherits each will stand.

**Nothing in this PR changes a number in code, adds a migration, touches the
send path, or changes a planner prompt.**

## 1 · Rate changes — data entry, no code

W2 shipped the effective-dated editor at `/backoffice/pricing`, and the API takes
a **free-text action** (`creditPriceUpsertSchema.action`, `z.string().max(60)`),
so a new action key needs no deploy. Saving **appends** a row — the sequence per
`(agencyId, action)` is the change history, and a superseding row is the undo.

The locked card, as the owner should enter it (platform scope, `agencyId = null`):

| Action (suggested key)            | Credits | Effective from | Note                                                        |
| --------------------------------- | ------: | -------------- | ----------------------------------------------------------- |
| AI reply draft (`ai_reply_draft`) |   **2** | **2026-09-01** | was 1; owner rationale: breakeven at standard Sonnet $3/$15 |
| Enrichment — standard             |   **5** | now            | the single `enrichment` action **splits in two**            |
| Enrichment — deep                 |  **10** | now            | ditto                                                       |
| Email send                        |       1 | unchanged      | audit confirmed                                             |
| SMS segment                       |       2 | unchanged      | audit confirmed                                             |
| Guided email                      |       2 | unchanged      | matches the `GUIDED_EMAIL_CREDITS` display figure           |
| Guided SMS                        |       3 | unchanged      | matches the `GUIDED_SMS_CREDITS` display figure             |
| Regen                             |      10 | unchanged      | audit confirmed                                             |
| Voice minute                      |      15 | unchanged      | audit confirmed                                             |

The **AI reply draft** row is the reason effective-dating exists: enter it once,
dated 2026-09-01, and it takes effect on the day without anyone remembering.

## 2 · WhatsApp country dimension — DESIGNED, DEFERRED, NOT BUILT

Meta bills per **delivered template message** (since 2025-07-01), priced per
**category × country**: utility **2** · service-window reply **3** ·
international marketing **country-tiered 5–20** · **US marketing templates are
Meta-blocked** (since 2025-04-01), so there is no US marketing SKU to price.

Shipped `resolveCreditPrice` keys on `(action, agencyId)` only. The recorded
shape, for the unit that builds it:

- **Additive nullable `CreditPrice.country`** — `null` = single-rate action, so
  every existing row keeps its exact meaning and no backfill is needed.
- **Resolution becomes most-specific-first:**
  `agency+country → agency → platform+country → platform`.
- **Editor UI grows a country column for WhatsApp actions only** — every other
  action stays a single rate, and the column would be noise on them.

**Why it is not built now:** there is no WhatsApp producer. The `whatsapp.*`
catalog entries exist with no sender behind them, and Q-025 kept `whatsapp` out
of `KILL_SWITCH_CHANNELS` for exactly this reason — a switch nothing calls is a
no-op, and a priced action nothing can consume is the same mistake in the billing
spine. It lands with **the WhatsApp channel unit or Phase 10 enforcement,
whichever comes first**, as that unit's ride-along.

Inherited in three places so it cannot be missed:
`CHECKLIST_B1_BACKOFFICE_COVERAGE.md` (the WhatsApp finish bullet) ·
`DATA_MODEL.md §7` (the data contract) · a `DEFERRED` comment at the two code
sites that must change (`packages/core/src/backoffice.ts`,
`packages/db/prisma/schema.prisma`).

## 3 · SMS activation pass-through — decided, not built

Cost model §5a, FR-BILL-07/FR-SEND-07: **$15/mo per SMS-active tenant** plus the
**one-time TCR vetting fee**, billed **at cost as a Stripe line item — NEVER
credits**. Each sub-account gets its **own A2P brand + campaign; no pooling**.

The activation flow, ISV auto-registration and the `pending_registration` sender
state are a **separate future unit**.

**Reconciliation consequence — verified against the shipped view, no code
needed:** A2P fees arrive as **per-tenant fixed lines** on Twilio invoices. A
`ProviderInvoice` row whose `metric` is not in the `METERED` map already
reconciles **honestly as "not metered"** (`meteredQuantity: null`, no variance)
rather than as a false variance against our send counts — which is the correct
behavior for a pass-through we never meter. The activation unit decides at that
point whether a per-tenant A2P meter (count of SMS-active tenants) belongs in
`METERED`; today, adding one would meter something no tenant is charged for.

## 4 · The DEC entry, and one thing filed rather than fixed

**DEC-103** — one entry covering all four items (WhatsApp restructure · draft
1→2 · enrichment split · SMS activation decided/not-built). Claimed against live
`main`, where DEC-102 (INT W5) was the maximum.

**Q-063 — filed, deliberately not fixed.** The pre-audit numbers survive in two
code constants:

| Site                                                   | Reads today                                   | Locked card says                                          |
| ------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------- |
| `DEFAULT_CREDIT_PRICES` (`packages/db/prisma/seed.ts`) | sms 5 · voice 40 · enrichment 10 · whatsapp 8 | sms 2 · voice 15 · enrichment 5/10 · whatsapp per country |
| `CREDIT_PRICES` (`packages/core/src/strategy.ts`)      | the same values, mirrored                     | the same                                                  |

The second is **tenant-facing** — it renders the agent wizard's launch estimate.
Nothing is charged off either (Q-020: display-only, no ledger, no balance), but
a fresh seed and the wizard estimate now quote numbers the locked card
contradicts. The owner's amendment is explicit — _"no code"_, _"not a seed"_ —
so this PR **leaves both untouched and marks them in place**. The fix is to
**source** both from `CreditPrice` when FR-BILL-04 metering lands, never a third
hardcoded copy. Raised for the owner's call in the PR summary.

## Files touched

| File                                  | Change                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `PROGRESS.md`                         | status row · **DEC-103** · **Q-063** (the ledger of record)                         |
| `DATA_MODEL.md` §7/§9                 | the credit-pricing contract: locked card, deferred `country`, SMS pass-through rule |
| `PRODUCT_DECISIONS.md` D1             | the 2026 proposal is superseded by the locked card                                  |
| `CHECKLIST_B1_BACKOFFICE_COVERAGE.md` | ride-along inheritance: WhatsApp · Lead Finder enrichment split · SMS activation    |
| `packages/db/prisma/schema.prisma`    | `DEFERRED` comment on `CreditPrice` (comment only — no migration)                   |
| `packages/core/src/backoffice.ts`     | `DEFERRED` comment at `resolveCreditPrice` (the resolution order that will change)  |
| `packages/db/prisma/seed.ts`          | Q-063 marker on `DEFAULT_CREDIT_PRICES` (values untouched)                          |
| `packages/core/src/strategy.ts`       | Q-063 marker on `CREDIT_PRICES` (values untouched)                                  |

## §8 evidence

**Not applicable — no UI change.** This PR ships no screen, no state matrix and
no behavior: every code touch is a comment, and the price editor it documents was
captured in W2's set (`docs/fidelity/b1-w2/build-pricing`). Verification is
`pnpm build` · `pnpm lint` (incl. `lint:ledger`, which is what proves the DEC-103
and Q-063 claims are collision-free) · `pnpm test`.

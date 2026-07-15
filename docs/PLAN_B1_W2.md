# PLAN — Platform backoffice, wave W2 (unit "B1 W2", DEC-080, 2026-07-15)

> Status: **PLAN POSTED** — branch `claude/session-oxcd68`. Wave W2 of the B1 unit
> (builds on W1 / DEC-079, merged in #95). Plan-comment-first per protocol; W3/W4
> follow as their own PRs.

## Goal

Give the platform operator the numbers to run the business (FR-ADMIN-02/03):
**per-tenant consumption**, the **provider-invoice reconciliation** view (the
FR-BILL-04 enforcement prerequisite), and the **credit-price editor** (FR-BILL-02's
home). All on the W1 backoffice rail (platform-staff auth, RLS-exempt client,
audited mutations).

## Honest-absence rails (load-bearing — no invented metrics)

Two real gaps exist today; W2 surfaces them honestly rather than fabricating:

- **AI spend is not metered.** `packages/ai` computes per-call cost for logging
  only — nothing persists it. Usage shows AI spend as **"not yet metered"** (a
  small follow-up: emit `ai.spend.v1` from the gateway; natural fit with W3).
- **Per-send credit consumption is not wired.** The `CreditLedger` is currently
  written only by W1's manual grants; sends don't decrement credits yet. That
  wiring IS FR-BILL-04 ("enforce credits after one reconciled month") — gated on
  the reconciliation view this wave builds. So "credit burn" = the real ledger
  (honestly, mostly manual adjustments today), and the metered-usage columns come
  from the event ledger, which is fully populated.

## Data model (additive only)

```prisma
model ProviderInvoice {          // platform-global (no workspaceId); backoffice-only
  id String @id @default(cuid())
  provider String                // "sendgrid" | "twilio" | "anthropic" | …
  periodStart DateTime
  periodEnd   DateTime
  metric String                  // "email_sends" | "sms_segments" | "voice_minutes" | …
  quantity Int                   // provider-reported quantity
  amount   Int                   // provider-reported amount, integer minor units (cents)
  currency String @default("USD")
  source   String @default("manual")  // "manual" | "csv" | "api" (provenance)
  createdAt DateTime @default(now())
  @@index([provider, periodStart])
}
```

- REVOKEd from `clientforce_app` like the other backoffice tables (defense in depth).
- **Credit prices reuse the existing `CreditPrice`** (`agencyId?`, `action`,
  `credits`, `effectiveFrom`) — no schema change. The editor **appends**
  effective-dated rows (never updates in place), so the row sequence per
  `(agencyId, action)` IS the change history.
- **Usage rollups are on-demand** aggregations over `Message` / `Event` /
  `CreditLedger` — no new rollup table this wave (`MetricDaily` stays the future
  home if query cost demands it; flagged, not built).

## API (backoffice module, staff-auth + audited)

- `GET /backoffice/usage?scope=agency|workspace&id&from&to` — consumption:
  sends by channel (`Message` OUTBOUND / `*.sent.v1`), voice minutes
  (`call.completed.v1.durationSec`), credit burn (`CreditLedger` deltas < 0),
  AI spend (honest-absence). Below a sample floor → "low data", never a fabricated rate.
- `GET /backoffice/reconciliation?provider&month` — our metered usage vs the
  seeded `ProviderInvoice` for that provider/period: quantity delta + variance %.
- `GET /backoffice/credit-prices?agencyId` — effective prices now (platform
  defaults + agency overrides, resolved: newest `effectiveFrom ≤ now`, agency
  match beats null default) + full history.
- `POST /backoffice/credit-prices` — append an effective-dated row (platform
  default when `agencyId` null, else per-agency override); audited
  (`price.set`, before/after in metadata).

Price resolution is a pure `packages/core` helper (`resolveCreditPrice`) so the
wizard cost estimate and the editor read the same rule.

## UI surfaces (backoffice)

1. `/backoffice/usage` — per-agency/workspace consumption (channel breakdown,
   voice minutes, credit burn; AI spend shown as "not yet metered").
2. `/backoffice/reconciliation` — per provider per month, metered vs invoice, with
   the variance and a "matches fixture" indicator.
3. `/backoffice/pricing` — the credit-price editor: current effective table
   (defaults + overrides) + add-effective-dated-row form + per-action history.

## Explicitly deferred (own PRs)

- **W3** — product telemetry + adoption dashboards (FR-TELEM-01..04). Provider
  proposed today as a standalone comment for owner async confirm; W3 starts on
  W2 merge with the provider locked. (`ai.spend.v1` metering rides W3.)
- **W4** — fleet health, abuse surfacing, per-agency/channel kill switch,
  read-only impersonation, feature flags.
- **FR-BILL-04 enforcement** (decrement credits on send / block at zero) — gated
  on "one reconciled month"; this wave builds the reconciliation view to reconcile
  against, not the enforcement.

## Acceptance

- usage rollup matches hand-computed counts for a seeded tenant (sends by channel
  + voice minutes) and shows credit burn from the real ledger; AI spend is an
  honest "not yet metered", never a number;
- the reconciliation view matches a seeded `ProviderInvoice` fixture (zero
  variance when metered usage == invoice; correct variance when it differs);
- a price override takes effect effective-dated (agency override beats platform
  default; history preserved; `resolveCreditPrice` unit-pinned);
- every price change writes a `BackofficeAuditLog` row;
- RLS regression still pinned (tenant paths untouched; `ProviderInvoice` REVOKEd
  from `clientforce_app`). API suite green vs real Postgres; §8 build evidence
  under `docs/fidelity/b1-w2/`.

DEC-080 claimed at dispatch (collision-free vs main `668cb06`).

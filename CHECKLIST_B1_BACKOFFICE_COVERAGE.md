# B1 close-out — Backoffice coverage checklist (the five spines × today's surface area)

> Purpose: the backoffice was built before the platform is feature-complete. It stays
> complete BY CONSTRUCTION because it manages five shared SPINES, not individual
> features — any feature that respects the spines lights up in the backoffice with no
> backoffice code. This checklist proves the pattern holds for everything that exists
> today, and is the reference every future kickoff's ride-along line points at.
> W4 verifies each ✓ against the merged surface; anything unchecked is a gap to file,
> not to silently accept.

## The five spines the backoffice reads (never per-feature integrations)

1. **Event ledger / catalog** — fleet views, telemetry, abuse surfacing read the ledger.
   A new feature that emits catalog events is visible with zero backoffice change.
2. **Credit ledger** — usage/reconciliation aggregate deltas. A new billable action adds
   a delta type; the rollup picks it up.
3. **Send-boundary refusal enum** — the kill switch acts here (TENANT_SUSPENDED pattern).
   A channel that ports the rail order is killable without new backoffice code.
4. **Health-score endpoint (P5-W1)** — one score contract; fleet health CONSUMES it,
   never recomputes.
5. **RLS-exempt read + tenant/workspace tables** — new tenant-scoped tables are visible
   to the cross-tenant read automatically.

## Coverage today (spine × surface) — W4 proves each

| Surface (exists today) | Emits events | Credit deltas | Killable (boundary) | Health-scored | Tenant-table visible |
|---|---|---|---|---|---|
| Email channel | ✓ email.* | ✓ send | ✓ | ✓ sender | ✓ |
| SMS channel | ✓ sms.* | ✓ segment | ✓ | ✓ sender | ✓ |
| Voice (#93, pending) | ✓ call.* | ✓ minute | ⚠ pending its rail (P3.2) — NOT in the enum | n/a (number) | ✓ |
| Agents / campaigns | ✓ lead.*, stage_changed | ✓ regen | via channel | — | ✓ |
| Contacts / lists | ✓ list.member.* | — | — | — | ✓ |
| Sequence editor (#90) | ✓ (graph events) | ✓ regen | via channel | — | ✓ |
| Sub-campaign rules (R1) | ✓ rule fires | — | — | — | ✓ |

Blank = not applicable to that spine (correct, not a gap). "via channel" = killable
through the channel it sends on, not a separate switch.

## Not-yet-built surfaces — coverage is a RIDE-ALONG on each unit's own PR

Each of these must wire into the relevant spine IN THE SAME PR that builds it — never a
later backoffice retrofit:

- **WhatsApp finish** → emit whatsapp.* catalog events · port the refusal rail, and RE-ENTER
  `KILL_SWITCH_CHANNELS` in the same PR (killable). Until then WhatsApp is NOT in the kill-switch enum (Q-025).
- **Voice graph nodes (P3.2)** → inherits voice's spine coverage; no new work if it reuses call.* + the rail.
- **Widget / Forms / Proposals** → emit catalog events · register credit deltas for any billable action · proposals' Stripe path emits payment events.
- **Lead Finder / prospecting** → emit discovery events · credit delta per enriched/signal lead · per-source kill via the boundary pattern if it sends.
- **Automations UI (R1 remainder)** → runs are already events; surface run history read-only.
- **Analytics / Billing (Phase 10)** → billing enforcement (FR-BILL-04) consumes W2's reconciliation; no parallel meter.

## The rule (also in the kickoff template)

If a future unit introduces a **new billable action, a new event type, a new kill-worthy
send path, or a new manageable tenant entity**, it wires into the matching backoffice
spine in the SAME PR. If a management need can't be expressed through one of the five
spines, that's the signal to EXTEND A SPINE — not to bolt a feature-specific panel onto
the backoffice. File it as a Q against this checklist.

---

## W4 verification (2026-07-15, PR #99 / DEC-082) — close-out proof

Each spine + each grid ✓ verified against the built backoffice (W1–W3 merged; W4 on #99,
CI-green). Citations are code + the test that pins them.

### Spines — all five proven

| Spine | How the backoffice reads it (generic, not per-feature) | Proof |
|---|---|---|
| 1 · Event ledger | `fleetHealth` groups `Event` by `type` for outliers; W2 `usage` reads `Message` + `Event`; W3 `adoption` reads `TelemetryEvent` — all generic `groupBy`/`findMany`, no per-feature branch | `backoffice.service.ts` (`fleetHealth`/`usage`/`adoption`); `backoffice-fleet`/`-usage`/`-adoption` e2e |
| 2 · Credit ledger | `usage` sums `CreditLedger.delta` (burn/granted) generically — any delta type is picked up | `backoffice-usage.e2e.spec.ts`; **caveat below** |
| 3 · Send-boundary refusal enum | `assertChannelLive` beside `assertTenantActive` at the email + SMS boundaries; kill switch = one `KillSwitch` row, no send-path fork | `send.ts:66` / `send-sms.ts:78`; `backoffice-fleet.e2e.spec.ts` (kill→`CHANNEL_KILLED` 422→restore); **Q-025 below** |
| 4 · Health endpoint (P5-W1) | `SenderHealthClient` fetches P5-W1's endpoint; unset → honest `wired:false`, never a second computation | `sender-health.ts`; `backoffice-fleet.e2e.spec.ts` (`wired:false` pending) |
| 5 · RLS-exempt read | `createBackofficePrismaClient` (BYPASSRLS) reads every tenant's rows with no GUC | `backoffice-rls.test.ts` (reads both tenants; app fails closed) |

### Grid cells — proven, with two honest caveats

- **Rows Email / SMS / Agents / Contacts / Sequence editor / Sub-campaign rules:** every
  `✓` holds. The "Emits events" column is proven by the catalog (`packages/events/src/catalog.ts`):
  `email.*`, `sms.*`, `call.*`, `lead.enrolled/stage_changed.v1`, `list.member.added/removed.v1`,
  `automation.rule.run.v1` all registered + versioned. "via channel" killable is accurate —
  agents/sequences/rules have no own send path; they send through email/SMS, which ARE killable.
  Tenant-table visibility holds for all rows via spine 5.

- **Caveat A — credit-delta metering is spine-ready, not emitting (documented, not a new gap).**
  The Credit-deltas `✓`s mean the rollup WOULD pick up a delta the moment it's written. Per-action
  metering (send / segment / minute / regen) is **FR-BILL-04-deferred** — the `CreditLedger` carries
  W1's manual grants today (DEC-080; Q-020 for guided-compose display-only credits). The **spine** is
  proven; the per-action deltas ride on the billing unit. No new Q — already tracked.

- **Gap → Q-025 (RESOLVED in this PR — owner ruling 2026-07-15).** The kill-switch enum originally
  offered email/sms/whatsapp/voice, but `assertChannelLive` — the enforcement gate — is wired into the
  **email + SMS** boundaries only (no voice/WhatsApp path calls it; grep across `apps/voice`/`packages/voice`
  is empty, WhatsApp sending isn't built), so `voice`/`whatsapp` switches would be **silent no-ops**.
  **Ruling: narrow the enum, don't ship a no-op.** `SEND_CHANNELS` → **`KILL_SWITCH_CHANNELS = ["email","sms"]`**
  (the core DTO + the kill-switch UI import it; a DTO test pins that voice/whatsapp are now *rejected*).
  Each channel RE-ENTERS the enum via the ride-along on the PR that wires its boundary rail (voice → P3.2
  rail port; WhatsApp → its finish PR) — the very rule this checklist establishes. The Voice grid cell is
  now ⚠ *pending its rail*, not ✓.

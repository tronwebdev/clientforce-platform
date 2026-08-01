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

| Surface (exists today)                                                                      | Emits events                                                                                                                                                                                                                                                                                                                                                                                         | Credit deltas                                                                                                                                                                                            | Killable (boundary)                                                                                                                                                                                                                                                         | Health-scored                                                        | Tenant-table visible                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email channel                                                                               | ✓ email.*                                                                                                                                                                                                                                                                                                                                                                                            | ✓ send                                                                                                                                                                                                   | ✓                                                                                                                                                                                                                                                                           | ✓ sender                                                             | ✓                                                                                                                                                                   |
| SMS channel                                                                                 | ✓ sms.*                                                                                                                                                                                                                                                                                                                                                                                              | ✓ segment                                                                                                                                                                                                | ✓                                                                                                                                                                                                                                                                           | ✓ sender                                                             | ✓                                                                                                                                                                   |
| Voice (#93; SPEC A/DEC-099 extends this row)                                                | ✓ call.* · voice.compose_refused · **voice.context_retrieved.v1** (SPEC A: one summary per call, not per lookup)                                                                                                                                                                                                                                                                                     | ✓ minute (SPEC A adds no new billable action — a lookup's embedding + extra tokens ride the EXISTING per-call gateway cost accounting into `Call.costUsd`, so B1-W2 usage picks it up with no new meter) | ✓ (ride-along landed with #93's dial rail — `assertDialAllowed` calls `assertChannelLive("voice")`; back in the enum. SPEC A adds no kill-worthy surface: retrieval is a READ, not a send path)                                                                             | n/a (number)                                                         | ✓ (+ **`CallRetrieval`** — workspace-scoped RLS table, so the RLS-exempt backoffice read sees it generically)                                                       |
| Agents / campaigns                                                                          | ✓ lead.*, stage_changed                                                                                                                                                                                                                                                                                                                                                                              | ✓ regen                                                                                                                                                                                                  | via channel                                                                                                                                                                                                                                                                 | —                                                                    | ✓                                                                                                                                                                   |
| Contacts / lists                                                                            | ✓ list.member.*                                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                        | —                                                                                                                                                                                                                                                                           | —                                                                    | ✓                                                                                                                                                                   |
| Sequence editor (#90)                                                                       | ✓ (graph events)                                                                                                                                                                                                                                                                                                                                                                                     | ✓ regen                                                                                                                                                                                                  | via channel                                                                                                                                                                                                                                                                 | —                                                                    | ✓                                                                                                                                                                   |
| Sub-campaign rules (R1)                                                                     | ✓ rule fires                                                                                                                                                                                                                                                                                                                                                                                         | —                                                                                                                                                                                                        | —                                                                                                                                                                                                                                                                           | —                                                                    | ✓                                                                                                                                                                   |
| Widget (WID2 W1, DEC-101)                                                                   | ✓ `widget.conversation_started.v1` — a catalog entry authored with the data model that had NO producer until this unit; the session create is it (one firing per session, best-effort off the visitor's critical path)                                                                                                                                                                               | ✓ `widget_turn` credit PRICE registered (spine 2's "register a delta type"); metering itself stays with Phase 10's reconciliation — the no-parallel-meter rule                                           | ✓ **"widget" RE-ENTERS `KILL_SWITCH_CHANNELS`** — earned, not declared: the answer boundary calls `assertTenantActive` + `assertChannelLive("widget")` before an embedded agent may say anything to the public, and an e2e flips a real KillSwitch row to prove the refusal | n/a (no sender)                                                      | ✓ `WidgetSession` is workspace-scoped with RLS (isolation proven vs real Postgres as the non-superuser role), so the RLS-exempt backoffice read sees it generically |
| Integrations (INT W1 Slack · W2 calendar/booking · W3 Stripe/webhook · W4 HubSpot CRM push) | ✓ integration.* + calendar.* + payment.received.v1 (W3, TENANT revenue — no platform credits) + the outbound webhook/CRM push settles ride integration.notified/sync_failed/delivery_held (connect/disconnect audit · status transitions · inbound payment claims · outbound deliveries + holds · bookings/reschedules/cancels; the booking's stage change rides the EXISTING lead.stage_changed.v1) | — (no billable action; Slack/HubSpot/webhook API calls are free — the shared 500/day allowance is a storm brake, not a meter)                                                                            | n/a (Slack → the OWNER's channel · send_webhook → an owner-operated endpoint the SSRF guard pins to public https · CRM push → the owner's HubSpot — none is a lead-facing MESSAGE send; revisit if a lead-facing integration send ever exists)                              | n/a (probe-backed Integration.status, not the sender score contract) | ✓ (Integration + IntegrationDelivery are workspace-scoped RLS tables; the W4 crmDealId rides the already-RLS'd Enrollment.meta)                                     |

Blank = not applicable to that spine (correct, not a gap). "via channel" = killable
through the channel it sends on, not a separate switch.

## Not-yet-built surfaces — coverage is a RIDE-ALONG on each unit's own PR

Each of these must wire into the relevant spine IN THE SAME PR that builds it — never a
later backoffice retrofit:

- **WhatsApp finish** → emit whatsapp.* catalog events · port the refusal rail, and RE-ENTER
  `KILL_SWITCH_CHANNELS` in the same PR (killable). Until then WhatsApp is NOT in the kill-switch enum (Q-025).
  **Inherits DEC-103 (the 2026-08-01 pricing amendment):** its spine-2 entry is NOT one `whatsapp_msg`
  price — Meta bills per DELIVERED template message per **category × country** (utility 2 ·
  service-window reply 3 · intl marketing 5–20 · **no US marketing SKU**, Meta-blocked). So that PR also
  carries the deferred schema half: additive nullable `CreditPrice.country` (null = single-rate action)
  + most-specific-first resolution (agency+country → agency → platform+country → platform) + a country
  column in the price editor for WhatsApp actions only. Designed and recorded, deliberately unbuilt
  until there is a producer — `DATA_MODEL.md §7a`.
- **Voice graph nodes (P3.2)** → inherits voice's spine coverage; no new work if it reuses call.* + the rail.
- ~~**Widget**~~ **SHIPPED (W1) — WID2, DEC-101:** exactly as scoped — the catalog
  event has a producer, the billable action (`widget_turn`) has a registered price with
  no parallel meter, the send boundary is ported so the kill switch is real rather than
  a no-op, and `WidgetSession` is an RLS table the cross-tenant read sees for free. The
  spine delta is stated in the PR plan comment. **Forms / Proposals** remain: emit catalog
  events · register credit deltas for any billable action · proposals' Stripe path emits
  payment events.
- **Lead Finder / prospecting** → emit discovery events · credit delta per enriched/signal lead · per-source kill via the boundary pattern if it sends.
  **Inherits DEC-103:** enrichment is TWO priced actions now — standard 5 / deep 10 — so register both, not one.
- **SMS activation / A2P registration** (the flow, ISV auto-registration, the `pending_registration`
  sender state) → **no new billable action, no credit delta** (DEC-103): the $15/mo per SMS-active tenant
  + the one-time TCR vetting fee are a Stripe pass-through **at cost, never credits**, and each
  sub-account gets its OWN A2P brand+campaign (no pooling). Its spine touch is reconciliation — those
  fees arrive as **per-tenant fixed lines** on Twilio invoices, which today reconcile honestly as
  "not metered" (an unmapped `ProviderInvoice.metric`); that unit decides whether a per-tenant A2P meter
  belongs in `METERED`.
- ~~**Automations UI (R1 remainder)** → runs are already events; surface run history read-only.~~
  **SHIPPED — R1-UI (PR #105, DEC-091):** exactly as scoped — run history is LEDGER-sourced
  (`automation.rule.run.v1` Event rows, read-only) so spine 1 covers it automatically; the two
  new manage events (`automation.status_changed.v1` · `automation.deleted.v1`) ride the same
  catalog spine; NO new billable action, NO new send path (zero send actions at account scope
  BY DESIGN — kill-switch n/a), NO new manageable tenant entity beyond the workspace-scoped
  rows the fleet views already see. NIL spine delta, stated per the ride-along rule.
- **Analytics / Billing (Phase 10)** → billing enforcement (FR-BILL-04) consumes W2's reconciliation; no parallel meter.
  **Inherits DEC-103:** the locked rate card is `CreditPrice` DATA (never a code constant), and the two
  stale hardcodes (`DEFAULT_CREDIT_PRICES`, `CREDIT_PRICES`) get SOURCED from it here rather than
  re-hardcoded a third time (Q-063).

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

| Spine                          | How the backoffice reads it (generic, not per-feature)                                                                                                                                    | Proof                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1 · Event ledger               | `fleetHealth` groups `Event` by `type` for outliers; W2 `usage` reads `Message` + `Event`; W3 `adoption` reads `TelemetryEvent` — all generic `groupBy`/`findMany`, no per-feature branch | `backoffice.service.ts` (`fleetHealth`/`usage`/`adoption`); `backoffice-fleet`/`-usage`/`-adoption` e2e              |
| 2 · Credit ledger              | `usage` sums `CreditLedger.delta` (burn/granted) generically — any delta type is picked up                                                                                                | `backoffice-usage.e2e.spec.ts`; **caveat below**                                                                     |
| 3 · Send-boundary refusal enum | `assertChannelLive` beside `assertTenantActive` at the email + SMS boundaries; kill switch = one `KillSwitch` row, no send-path fork                                                      | `send.ts:66` / `send-sms.ts:78`; `backoffice-fleet.e2e.spec.ts` (kill→`CHANNEL_KILLED` 422→restore); **Q-025 below** |
| 4 · Health endpoint (P5-W1)    | `SenderHealthClient` consumes P5-W1's shared `computeSenderHealth` per sender IN-PROCESS (never forks the score math; DEC-083, P5-W1 merged #100)                                         | `sender-health.ts`; `backoffice-fleet.e2e.spec.ts` (real scores from the shared fn)                                  |
| 5 · RLS-exempt read            | `createBackofficePrismaClient` (BYPASSRLS) reads every tenant's rows with no GUC                                                                                                          | `backoffice-rls.test.ts` (reads both tenants; app fails closed)                                                      |

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
  (the core DTO + the kill-switch UI import it; a DTO test pins that voice/whatsapp are now _rejected_).
  Each channel RE-ENTERS the enum via the ride-along on the PR that wires its boundary rail (voice → P3.2
  rail port; WhatsApp → its finish PR) — the very rule this checklist establishes. The Voice grid cell is
  now ⚠ _pending its rail_, not ✓.
  **Ride-along landed (P3.1/#93, 2026-07-15):** the dial boundary (`assertDialAllowed`) wires
  `assertChannelLive("voice")` right after the suspension gate, `voice` is back in
  `KILL_SWITCH_CHANNELS` (DTO test flipped to _accepted_; dial-matrix test pins `CHANNEL_KILLED`
  block + clear-restores), and the Voice grid cell above is ✓. WhatsApp remains out until its
  finish PR.

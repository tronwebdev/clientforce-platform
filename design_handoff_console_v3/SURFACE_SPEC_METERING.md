# SURFACE SPEC — B9.5 · Metering

**Status:** owner-locked 2026-08-31. This unit closes **Q-108** and the metering half of
**FR-BILL-04**. It is a money unit, so correctness beats coverage: better to meter four actions
exactly than eight approximately.

---

## 1 · The problem, precisely

Priced actions exist (`CreditPrice` rows, resolved through `resolveCreditPrice(rows,
{agencyId, action})` — effective-dated, agency override first). **Nothing debits the ledger
when they happen.** Today only two writers exist:

- the **lead reveal** (`apps/api/src/leads/leads.controller.ts`): balance check →
  `creditLedger.create({ delta, reason, channel, balanceAfter })` → `workspace.update({
  creditBalance })`, all in one tenant transaction;
- **backoffice adjustments** (`backoffice.service.ts`): the same shape plus an audit row.

Everything else — email sends, SMS segments, call minutes, enrichment, audience syncs,
site-agent turns — happens for free. The console says so honestly today ("NOT METERED YET"),
which is why this is a gap and not a lie. But **until it ships, credits are decorative for
everything except reveals**, and billing cannot be turned on.

**Standing constraint (CHECKLIST_B1 §64): no parallel meter.** Billing enforcement consumes
W2's reconciliation. This unit therefore *extracts* the existing debit path — it does not add
a second one.

---

## 2 · The one charge path

Extract the reveal's transaction into a single helper — the reveal becomes its **first caller**,
not a sibling implementation. Signature (shape, not literal):

```
charge(tx, {
  workspaceId,
  action,            // CreditPrice action key
  quantity,          // segments, minutes, turns — default 1
  sourceType,        // "message" | "call" | "contact" | "sync" | "widget_turn" | "reveal"
  sourceId,          // the id of the row that was actually produced
  channel,           // for the ledger's channel column
  metadata,          // provider ids, rounding inputs — auditable
}) → { charged, balanceAfter } | { refused: "INSUFFICIENT_CREDITS", short }
```

Invariants:

1. **Append-only.** Never update or delete a ledger row. A correction is a new row.
2. **One transaction** with the balance move, as today. `balanceAfter` stays on the row.
3. **Price resolved at charge time** through `resolveCreditPrice` — never a literal, never a
   value cached from the UI.
4. **Quantity × price**, with rounding stated per action (§4).
5. **Idempotent on `(workspaceId, sourceType, sourceId, action)`** — see §3.
6. **Zero-price actions write nothing.** Anything Ada writes is free and must not produce a
   0-credit row (the rates copy promises this; a 0 row would also make "nothing has drawn down
   credits" false).

---

## 3 · Idempotency (the crux)

Retries, webhook replays and worker restarts must not double-charge. Add to `CreditLedger`:

- `sourceType TEXT NULL`, `sourceId TEXT NULL`
- `CREATE UNIQUE INDEX ON "CreditLedger"("workspaceId","sourceType","sourceId","reason")
  WHERE "sourceType" IS NOT NULL` — a partial unique index, so existing rows and manual
  adjustments (which have no source) are unaffected.

`charge()` inserts and treats a unique violation as **already charged, success** — returning the
existing row's `balanceAfter`. This is the whole safety story: the produced row's id is the
natural idempotency key, and it exists before the charge because we charge *after* the thing
happened.

---

## 4 · What is charged, when, and how it rounds

| Action | Charge point | Quantity | Rounding / rule |
|---|---|---|---|
| Email send | provider **accepted** the message (Message row has a provider id) | 1 | — |
| SMS send | provider accepted | **segments from the provider response** | never estimate segments locally |
| Call | `call.completed` webhook, with duration | minutes | **round up per minute**, as the rates copy states |
| Enrichment | on successful enrich | 1 | **once per contact, ever** — enforced by the idempotency key on `contact` |
| Lead reveal | already live | 1 | once per contact ever (existing behaviour, unchanged) |
| Audience sync | per list per run | 1 | ads add-on only |
| Site-agent turn | turn completed | 1 | only if the priced key is kept; otherwise remove the price row rather than leave it unmetered |
| Anything Ada writes | never | — | drafting, classifying, deciding are free |

**Nothing is charged on failure.** A refused send, a failed dial, a bounce that the provider
rejects outright, a reveal that returns nothing — no row. Where a charge has already landed and
the outcome later invalidates it (hard bounce after acceptance), write a **compensating positive
row** with reason `refund_<action>` and `sourceId` pointing at the original, so the ledger stays
append-only and the refund is auditable. Soft bounces and complaints are **not** refundable —
say so in the rates copy rather than in code comments.

---

## 5 · Insufficient credits — slow, don't stop

The credits hero already promises: *"Ada slows non-urgent sends before you run dry, she does
not stop."* Make that literally true.

- **Pre-check at the boundary**, before the action: if `balance < price × quantity`, refuse
  **typed** (`INSUFFICIENT_CREDITS`) with the shortfall.
- **Urgency split**, using the `origin` field B3b already added: replies, human-initiated sends
  and human dials are **urgent** and proceed while any balance remains; scheduled campaign steps
  are **non-urgent** and pause. Never the reverse — a customer waiting on a reply must not be
  the thing that gets dropped.
- A paused step becomes a **hold** on the enrollment (the B3b reply-hold shape), released
  automatically when the balance rises. Not a failure, not a killed run.
- **Events**: `credits.low.v1` (crossing a workspace-set threshold, default the auto-top-up
  trigger) and `credits.exhausted.v1`. These drive the console's notice, the Ada bar line, and
  later the auto-top-up hook. No new notification spine.

---

## 6 · Surfaces that become true when this ships

No new UI. What changes is that existing honest-absence copy is replaced by real data:

- **Credits · Where they go** — the `NOT METERED YET` block shrinks to whatever genuinely
  remains unmetered, and metered kinds appear as real rows with real bars. When nothing is left,
  the block disappears entirely.
- **Credits hero** — `USED THIS MONTH` becomes a real figure; **burn and runway appear only
  after ≥14 days of ledger history** (the §9.3 gate stands — do not shortcut it because rows now
  exist).
- **Call sheet** — the B3c-1 line "the set rate; minutes don't draw down credits yet" becomes
  the plain rate. Update it in the same PR; the two surfaces may not disagree.
- **Plan step / campaign plan** — per-step credit costs remain priced from `CreditPrice`
  (already true) and now reconcile with what actually gets charged.
- **Lead finder** — reveal pricing unchanged; it was always the one honest meter.

---

## 7 · Acceptance criteria

1. One `charge()` helper; the reveal calls it. Grep proves no second `creditLedger.create` in
   feature code (backoffice adjustments excepted).
2. Charging twice for the same produced row is impossible: a replayed webhook and a retried
   worker both leave exactly one row, proven by test.
3. A failed send, a failed dial and a failed reveal each leave **zero** rows.
4. A hard bounce after an accepted send leaves the debit **and** a compensating refund row,
   netting zero, with both rows linked.
5. SMS segments come from the provider response, not a local estimate; call minutes round up.
6. Enrichment and reveal each charge **once per contact ever**, across campaigns.
7. With a balance below the price: a reply send **succeeds**, a scheduled campaign step
   **holds**, and the hold releases when the balance rises — no killed runs.
8. `credits.low.v1` and `credits.exhausted.v1` fire once per crossing, not per attempt.
9. Zero-price actions write no ledger rows.
10. Prices come from `resolveCreditPrice` at charge time; no literal price anywhere in the
    charge path; an agency override changes what is charged.
11. Balance never goes negative outside an explicit backoffice adjustment.
12. Provider cost reconciliation (W2) still balances against the new ledger volume — no parallel
    meter, no double counting.
13. Every claim of a green suite quotes the uncached run (the standing rule from the turbo-cache
    correction).

---

## 8 · Questions to file rather than decide

- The low-balance threshold: workspace-set, plan-derived, or platform default?
- Site-agent turns: metered per turn, or free like drafting? (If free, remove the price row.)
- Whether an unmetered legacy period needs a stated cut-over date in the UI.
- Whether soft bounces and complaints should ever refund (current ruling: no).
- Per-tier included allowances — still owner-set in the billing UI (D2); this unit must not
  assume any number.

---

## 9 · Sequencing

**`B9.5 · Metering` runs after B6.5 and before B10.** Before the agency suite, because
agency-level billing over an unmetered product compounds the error; after B6.5 because the lead
finder is the one surface whose meter already works and its re-skin should not be blocked.

Dependencies: `CreditPrice` + `resolveCreditPrice` (shipped), the reveal debit (shipped, becomes
the first caller), `origin` on sends (shipped, B3b), the reply-hold shape (shipped, B3b), the
event bus (shipped), W2 reconciliation (shipped). Nothing here waits on Stripe — Stripe is how
credits get *bought*, not how they get *spent*.

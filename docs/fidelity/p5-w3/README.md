# P5 W3 — Pipeline board + deliverability hardening (§8 evidence)

## 1 · Pipeline board (owner-directed designed addition — Q-024 ANSWERED)

No prototype models a board (Q-024's finding), so per the owner's answer this
is a **Pipeline tab on Campaign View built as a §0-flagged designed addition**
— §0 atoms only (white column cards on the warm canvas, hairline borders,
status-pill idiom, skeleton/error/empty states), native HTML5 drag (no new
dependency). Captured at 1440×900 on the real local stack:

| state | shot |
| --- | --- |
| Board — stage columns from the EXISTING `PipelineStage` rows (ordered), per-column counts, honest per-column empties, the out-of-set **"Other stages"** overflow column (read-only — its keys aren't stages) | `build-board.png` |
| Drag walk — Omar Haddad dragged Interested → Booked; Interested renders its honest empty | `build-drag-after.png` |

**Drag → event → rules (the regression):** the drag calls the standard manual
move (`PATCH /enrollments/:id`), which now publishes through the EVENTS
PUBLISHER instead of writing the row directly — the persisted event from the
capture drag:

```
lead.stage_changed.v1  {"fromStage":"interested","toStage":"booked","manual":true,
                        "goalKey":"Book new-patient appointments for the clinic.","label":"Goal met"}
```

`manual: true` survives catalog validation (additive schema field), the C2.9
goal metadata still rides booked moves, and the **rules that listen fire for
human moves**: pinned in `engine.integration.test.ts` (a `manual: true`
stage_changed event matches `meeting_booked` and records its run) plus the
e2e pin that the endpoint's event lands with `manual` preserved.

## 2 · Spike alert events

`sender.spike_detected.v1` — emitted on the RISING EDGE per signal (bounce /
spam at/over its owner-locked danger bound; the same predicate that holds a
mid-warmup ramp). Pinned in `health.integration.test.ts`: an 8% bounce window
emits ONCE; a second recompute of the sustained spike stays quiet; clearing
and re-spiking emits again. B1-W4's fleet consumes these straight off the
ledger — no backoffice-specific path. The W2 drawer Activity card renders
them ("Bounce spike — 8.0% in the window (over the danger line)").

## 3 · Suppression hygiene

`runSuppressionHygiene` (worker sweep, boot + daily): **case-duplicate merge**
(the unique key is case-sensitive — oldest row wins), **address
normalization** to lowercase, **opt-out sync** (a suppressed address's contact
regains its `optOut` flag), and an **aging-bounce count** (>90d — visibility
only; expiry is a product decision, never automated). Same-PR hardening:
every email suppression writer now lowercases and the boundary matches
lowercase — integration-pinned that a MIXED-CASE contact refuses against its
suppression row (previously it could slip past). Idempotency pinned (second
pass = all zeros).

## 4 · Ledger perf pass (before/after, 50,303 messages in the workspace)

Senders-list `sentToday` — the last JSON-path consumer, moved to the W1
`senderId` column:

| query shape | plan | execution |
| --- | --- | --- |
| BEFORE — `meta->>'senderId'` filter | bitmap scan on `[workspaceId, contactId, sentAt]` + heap re-check of 4,960 rows | **12.316 ms** |
| AFTER — `senderId` column | Index Cond on `[workspaceId, senderId, channel, sentAt]` | **5.303 ms** |

2.3× at this volume — and the BEFORE shape degrades with **workspace** daily
volume (it filters every send that day) while AFTER scales only with the
sender's own sends. The health-window Event rollup (born on the W1 index)
runs as an **Index Only Scan** on `[workspaceId, senderId, type, occurredAt]`
— **0.187 ms**. `sentToday` for SMS senders now counts their own channel
(previously hardcoded `email` — always 0 for SMS rows; correctness fix riding
the pass, flagged).

## Verification

`pnpm build` · `pnpm lint` · `pnpm test` green vs real Postgres 16 + Redis —
channels 143 (+3: spike edge, hygiene walk incl. the mixed-case boundary pin),
automations +1 (manual-move rule pin), api 125 (+2: pipeline-stages,
manual-preserved publish), web 52 (+5: board grouping pins + the spike copy).

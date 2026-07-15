# LH1 — List hygiene: email validation at every ingress (§8 evidence)

**No prototype models validation states** — the Contacts/import canon
(`Contacts.dc.html`) predates the unit, so every validation surface here is a
**§0-flagged designed addition**: §0 atoms only (warm cards, hairline
borders, the status-pill idiom, amber = held/queued, red = refused/excluded),
composed into the EXISTING import flow, Contacts table/drawer, agent header
and Logs feed — never a new screen. Captured at 1440×900 on the real local
stack (web + api + Postgres+RLS; the provider mocked at the SERVICE seam
exactly as CI mocks it, except the provider-down shot which exercises the
REAL ZeroBounce adapter with no key — the typed refusal, earned). Every DB
state was earned through the real pipeline: the mixed CSV entered through
the UI import, verdicts landed via `processValidationBatchChunk`, holds and
the refusal via `POST /enrollments` through the real gate.

## 1 · The import report (async, progressive, honest)

Mixed 55-row file: 40 deliverable · 8 catch-all (risky) · 6 dead mailboxes
(invalid) · 1 pre-suppressed address.

| state | shot |
| --- | --- |
| Import completes INSTANTLY; the report card polls progressively — “Validating 55 contacts — sending starts as they clear.” Never a blocking spinner | `lh1-01-import-report-validating.png` |
| Provider OUTAGE mid-batch (real adapter, no key → typed `PROVIDER_AUTH` refusal): batch HELD, “Validation is temporarily unavailable — queued to retry. Contacts stay safely held until verified.” Zero invented verdicts, zero silent enrolls | `lh1-02-import-report-provider-down-held.png` |
| Verdicts landed: **“40 valid · 8 risky (held) · 6 invalid (excluded) · 1 already suppressed”** — counts match the fixture verdict-for-verdict; row-level invalid detail (`mailbox_not_found`); exclusions download | `lh1-03-import-report-counts.png` |

The downloaded exclusion CSV (the report's honest-about-every-exclusion
artifact) is committed beside the shots: [`lh1-exclusions.csv`](./lh1-exclusions.csv)
— 6 invalid rows with provider sub-status + the suppressed row labeled
`already suppressed`.

## 2 · Contacts verdict chips

Rows chip only the ACTION-RELEVANT states (risky amber · invalid red ·
unverified neutral); `valid` stays quiet in the table and shows in the
drawer's full-state chip — suppression/unsub remains its own signal.

| state | shot |
| --- | --- |
| Risky rows (held from sending, workspace policy) | `lh1-04-contacts-chips-risky.png` |
| Invalid rows (excluded from campaigns) | `lh1-05-contacts-chips-invalid.png` |
| Drawer: “✓ Valid email” on a verified contact | `lh1-06-contact-drawer-valid-chip.png` |

## 3 · The enrollment gate (typed refusal + honest holds)

| state | shot |
| --- | --- |
| Logs tab: the typed refusal row — “Enrollment refused for Ada Gone — invalid email address (list hygiene)… Nothing was enrolled or sent.” (`contact.enrollment_refused.v1`, a REAL Event row) + the header chip “Validating 2 contacts — sending starts as they clear” for two held walk-ins | `lh1-07-logs-gate-refusal-and-chip.png` |
| The cap walk: campaign cap 3, three verified enrollments today, five more attempts → all HELD `cap_overflow`; header chip “5 queued (daily enrollment cap)” | `lh1-08-agent-chip-cap-queued.png` |

The cap's next-day drain (day 2 releases 3, day 3 releases the last 2,
nothing double-starts) and the mid-validation launch walk (zero sends until
verdicts, progressive release, no unverified send ever) are pinned end-to-end
in `apps/api/test/enrollment-gate.e2e.spec.ts` — durable-clock walks belong
to the suite, not to screenshots.

Capture discipline: dev-local Playwright driving the real stack; capture
spec + fixture script deleted before commit (the G-fidelity precedent).

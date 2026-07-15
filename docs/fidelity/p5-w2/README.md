# P5 W2 — Settings → Senders live (§8 evidence)

Canon: `design_handoff_clientforce_restyle/prototypes/Settings.dc.html` (list
sections + the 500px `senderDetailOpen` drawer). Captured at **1440×900** on
the real local stack (Postgres 16 + RLS role, Redis, api :3001, web :3000
production build, dev-login as the seeded owner). **Every health/warm-up state
is EARNED through the W1 engine** — the capture seed writes real Message/Event
ledger rows and runs `recomputeSenderHealth`, never a painted snapshot
(Excellent = 100 from a clean 120-send ledger; Watch = 60 from spam exactly at
the 0.3% danger bound; Auto-paused = 10 from a real bounce storm; the held
ramp = an open interlock hold). The prototype renders from the repo file over
localhost with its unpkg/Google-Fonts deps fulfilled by Playwright route
interception (npm-registry copies of the same pinned versions — prototype file
untouched, w3-4 precedent). Capture scripts are dev-local, not committed.

## Frames

| state | prototype | build |
| --- | --- | --- |
| Email senders list (pills + 3-state DNS chips) | `proto-email-list.png` | `build-email-list.png` |
| Drawer — healthy (ring · tiles · warm-up Complete · DNS Pass) | `proto-drawer-healthy.png` | `build-drawer-excellent.png` |
| Drawer — warming + warm-up card (Day N of 45, current → target) | `proto-drawer-warming.png` | `build-drawer-warming-low-data.png` |
| Drawer — watch band (ring 60, exactly the locked cutoff) | (same canon anatomy) | `build-drawer-watch.png` |
| Drawer — auto-paused (<40) + DMARC Fail + copyable expected + collapse in Activity | (fixture `acc_91b3d8` carries the DMARC-fail anatomy) | `build-drawer-auto-paused.png` |
| Drawer — warm-up HELD by the health interlock (owner lock) | no canon (designed state, flagged) | `build-drawer-warmup-held.png` |
| Pause walk (typed + audited) | no canon (designed addition, flagged) | `build-pause-walk.png` |
| Re-check DNS walk (REAL lookups → honest unchecked/failed) | canon link, live action | `build-recheck-walk.png` |
| Resume + audit rows in Activity | no canon (designed addition) | `build-resume-audit.png` |
| Mailer list | `proto-mailer-list.png` | `build-mailer-list.png` |
| SMS list — Warming pill on a ramping number | (canon pill vocabulary) | `build-sms-list.png` |

The re-check walk is honest end-to-end: the capture API runs with **no
SendGrid key and a non-existent domain**, so re-checking replaces the seeded
"verified" set with `Unchecked` (SPF/DKIM — provider unavailable) + `Fail`
(DMARC — NXDOMAIN, with the copyable expected TXT record). Never
cached-as-verified, on camera.

## Deviations (logged in PROGRESS.md, DEC-084)

- **Ring states = the owner-locked bands** (healthy ≥80 · watch 60–79 ·
  at-risk 40–59 · auto-pause <40 + the F1 low-data floor). Prototype labels
  kept where they exist (Excellent ≥90 / Good 80–89, green); `Watch`,
  `At risk`, `Auto-paused` and the `—` low-data ring are designed states the
  prototype never modeled (its fixtures show 98/85/72 only). "Warming up" is
  the low-data floor label (dispatch copy), colored neutral `#9AA59E`.
- **Pause/resume** — the prototype footer has only Reconnect/Remove; the
  pause/resume button is a designed addition (typed `PATCH /senders/:id`,
  audited as `sender.status_changed.v1`, rendered in Activity).
- **Activity card** — designed addition: sender events carry no
  agent/campaign context, so the agent Logs tab can't surface them; the
  drawer timeline renders the mapped types only (DEC-057, no raw slugs).
- **Daily-limit inline edit** — designed addition (the dispatch's
  "daily-limit config"); the canon drawer shows the limit read-only.
- **"Copy expected record"** on failed DNS rows — action is a designed
  addition; the records themselves are canon (the mailer connect flow's DNS
  step displays the same records to publish).
- **This week / All time tiles** are now REAL (W1's `senderId` columns);
  ISP reputation, blacklists, token expiry and "Used by agents" remain
  omitted — still no backend (never faked).
- List "Sending" pill vocabulary: `Good / Warming / Paused / Auto-paused /
  Needs verification` — canon words where they exist; `Paused`/`Auto-paused`
  flagged. Watch/at-risk bands surface in the drawer ring only (the pill
  vocabulary stays canon-small).

## Verification

`pnpm build` · `pnpm lint` · `pnpm test` green vs real Postgres + Redis
(api 123 incl. the new pause/resume + tiles e2e; web 47 incl. 11 new display-mapping pins
importing the SAME `@clientforce/core` band contract the boundary enforces).

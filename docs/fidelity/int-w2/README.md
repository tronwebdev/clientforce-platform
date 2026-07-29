# INT W2 — Calendar & booking · §8 evidence (12 build shots + 5 proto twins + walk receipts, 1440×900)

Canon: `design_handoff_clientforce_restyle/prototypes/Integrations.dc.html`
(calendar cards · the calendar-category wizard: auth → "Calendar settings" →
summary · the `fields` step kind on Custom SMTP) — plus the Inbox/Leads/
Pipeline surfaces the booking rows land on (their own canons, already ported).

Every frame is the REAL stack: Postgres 16 + pgvector migrated to branch head,
Redis, api :3001 (nest build, raw-body on), worker (bus consumers + sweeps
live), web :3000 (production build), dev sign-in, seeded demo workspace
(augmented by the walk's staging: workspace BusinessContext, an ACTIVE
CF_MANAGED sender, Ada's enrollment + a 2-message thread). **Vendors are
stubbed at their HTTP seams** (the SLACK_BASE_URL precedent): Google OAuth +
calendarList/freeBusy (`GCAL_AUTHORIZE_URL`/`GCAL_TOKEN_URL`/`GCAL_BASE_URL`),
the Calendly API (`CALENDLY_BASE_URL` — /users/me, webhook subscriptions),
the composer's model call (`ANTHROPIC_BASE_URL`), SendGrid
(`SENDGRID_BASE_URL`), Slack (`SLACK_BASE_URL`). Nothing UI-side is mocked;
every state was EARNED through the API/bus/RLS. The real-vendor proof rides
the W4 staging chain (Google keys are in the vault; Calendly needs the
owner's real scheduling link — the demo gate).

## Frames

| Frame                                                                           | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proto-integrations-grid-calendar` ↔ `build-integrations-grid-calendar-live`    | The calendar cards flip LIVE: Google Calendar + Calendly render the canon card anatomy with real + Connect affordances (their `ABSENT_REASONS` entries retired this wave); every other unbuilt provider keeps its honest "Arrives with…" reason.                                                                                                                                                                                                                                                                                                                                  |
| `proto-calendar-wizard-auth` ↔ `build-gcal-wizard-auth-disclosure`              | Wizard step 1 per the canon calendar flow (auth step, perms list, category-generic `buildFlow`). Designed addition (flagged): the amber **test-user disclosure** — "Available to test accounts while Google verification completes…" — rendered unconditionally; a non-test Google account gets the callback's honest `?error=` banner, never a fake connected state.                                                                                                                                                                                                             |
| `proto-calendar-wizard-calendar-settings` ↔ `build-gcal-wizard-calendar-picker` | The canon "Calendar settings" step built as a LIVE calendar picker — a real `calendarList` page through the adapter + options endpoint (`kind=calendars`), not the canon's static select. Canon's "Event title" select + buffer toggle are NOT built (flagged): W2 never creates calendar events — Calendly puts bookings on the calendar natively; slots in copy are informational, the LINK is the booking mechanism.                                                                                                                                                           |
| `proto-gcal-drawer-connected` ↔ `build-gcal-drawer-connected`                   | The connected drawer: Live·Connected pill (probe-backed — a real calendarList call), account = the primary calendar id, the picked calendar row + Availability/Offer-slots sync rows.                                                                                                                                                                                                                                                                                                                                                                                             |
| `proto-fields-step-smtp` ↔ `build-calendly-fields-step`                         | **Flagged adaptation:** Calendly has NO platform OAuth app — the connect is the canon's `fields` step KIND (the Custom SMTP precedent): scheduling link (required, tier 1) + API token (optional, `pw`, tier 2). Both tiers visible in one frame.                                                                                                                                                                                                                                                                                                                                 |
| `build-calendly-drawer-connected`                                               | Tier-2 connected: "✓ Booking detection live — webhook subscription active" (a REAL subscription create against the stubbed API, idempotent list-then-create, per-workspace signing key), the capability webhook URL row + Copy, the setup timeline. The link probe is real HTTP (see disclosures).                                                                                                                                                                                                                                                                                |
| `build-trigger-picker-meetings-live`                                            | The builder trigger picker filtered to "meeting": meeting_booked joined by the three NEW kinds — Meeting rescheduled, Meeting canceled · no-show, Before a meeting (hours payload) — all schema-registered in the ONE vocabulary; the three W1 absent-Meetings entries are GONE (drift-test-forced).                                                                                                                                                                                                                                                                              |
| `build-action-picker-booking-link`                                              | Send booking link LIVE in the action list (non-send flag semantics, Q-039-honest) + the two re-filed absent reasons naming their paths (reminder = a SEND, re-files under the per-channel rule; create-event = needs Clientforce-created bookings).                                                                                                                                                                                                                                                                                                                               |
| `build-inbox-thread-booking-link-email` + `w2-stub-receipts.json`               | **The compose walk through the REAL rails:** the step composer loaded the calendly config, appended the deterministic booking talking point with the FULL per-lead link (`?utm_source=clientforce&utm_content=<Ada's contactId>` — grounded BY CONSTRUCTION), the model call went through the real gateway, the ungrounded-URL check passed on the real material, and the real send boundary appended the CAN-SPAM footer and persisted the Message ("✦ Composed" provenance tag + "composed from brief · checked against your rails" line visible). Zero planner prompt changes. |
| `build-inbox-thread-booking-system-row`                                         | **The booking, end-to-end:** a SIGNED `invitee.created` (t/v1 HMAC over the raw body, per-workspace key) → the @Public webhook → utm→contact correlation → Meeting row + `calendar.booked.v1` (the RECORD) → the ported C2.4 stage writer's ONE `lead.stage_changed.v1` → the thread's centered "📅 Meeting booked — Tue, Jul 28, 3:00 PM" system row (Event-sourced, never a fabricated Message — the send ledger stays honest).                                                                                                                                                 |
| `build-lead-drawer-calendar-timeline`                                           | The lead drawer timeline: the `calendar.booked.v1` row beside the stage-change row — the two-event anatomy (record + trigger carrier) visible on one lead.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `build-pipeline-booked-card`                                                    | Ada's card in the Pipeline BOOKED column — the webhook-driven stage move on the real board (goalKey rider → goal machinery; the same event fired the Slack notifier: `"📅 Meeting booked with Ada Lovelace"`, receipt in the JSON).                                                                                                                                                                                                                                                                                                                                               |

## Capture environment & disclosures

- Prototype twins rendered from the canon `.dc.html` with its React/Babel CDN
  dependencies fulfilled from local npm-tarball copies via route interception
  (the r1-ui precedent); prototype code untouched. The canon ships Google
  Calendar CONNECTED (its wizard canon is shot on Calendly's + Connect —
  `buildFlow` is category-generic, so the pair is like-for-like).
- **The walk is script-fired, rails-real** (the W1 publish-reply-event
  precedent): the harness plays only Temporal's timer — compose runs the real
  `createEmailStepComposer` (booking augmentation → grounded link), the send
  runs the real boundary (window/caps/suppression/footer/threading), the
  webhook POST is signature-verified by the real @Public endpoint, and every
  downstream row (Meeting, events, stage, Slack receipt, thread rows) was
  written by the real consumers off the real bus.
- **One in-process intercept, flagged:** the Calendly LINK probe fetches the
  user-pasted `https://calendly.com/...` URL directly — deliberately no env
  seam (the SSRF guard pins the host). The sandbox proxy blocks that host, so
  the harness preloads a fetch shim into the API process answering 200 for
  exactly that scheduling-page GET; every `api.calendly.com` call rides the
  `CALENDLY_BASE_URL` stub. The probe code path itself is untouched and
  covered by unit/e2e suites.
- The composer's model is a stub behind `ANTHROPIC_BASE_URL` that composes a
  plausible email INCLUDING the booking link it finds in the real prompt —
  the grounded-URL check then passes on real material (what a compliant model
  does); the deterministic checks all ran for real.
- The webhook capability token in `w2-stub-receipts.json` is masked
  (`token=eebf……2161`) — it is a throwaway local-DB token, masked anyway per
  the zero-secrets rule; the signing key is recorded by the stub and never
  printed.
- `build-integrations-grid-calendar-live` shows "3 of 15 connected" (Slack +
  gcal + calendly, all probe-backed this session) vs the canon's simulated 5 —
  the honest-count stance from W1 unchanged.

---

## The staging-ingress walk (DEC-103, owner ruling 2026-07-29)

Everything above was earned on the real LOCAL stack with the vendors stubbed at
their HTTP seams — Calendly at `CALENDLY_BASE_URL`. The owner ruled that W2's
booking walk should be re-run as a **staging-ingress walk**: point
`INTEGRATIONS_WEBHOOK_BASE` at the deployed staging API, create the subscription
THERE, and let Calendly deliver genuine webhooks into a running service, so the
twin semantics prove on real deliveries rather than replays.

Driver: `packages/integrations/scripts/calendly-staging-proof.ts`, dispatched as
the `calendly-staging-arm` / `calendly-staging-verify` walks of
`.github/workflows/integrations-live-proof.yml`.

### GENUINE vs REPLAYED — a receipt field, not prose

Every gate carries a `mode`. The two sets are never merged, and the replayed set
is never described as vendor behaviour.

| Proof                                        | Mode         | Why                                                                                                                                                                                 |
| -------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PAT probe (`/users/me`)                      | genuine      | the real vault PAT against `api.calendly.com`                                                                                                                                       |
| Subscription create → list                   | genuine      | a real vendor subscription pointing at the staging ingress                                                                                                                          |
| Subscription delete → list                   | genuine      | real teardown at the vendor (asserted live BEFORE the delete, so a 404 cannot pass it vacuously)                                                                                    |
| `invitee.created` (the booking)              | genuine      | the owner's real booking                                                                                                                                                            |
| `invitee.canceled` + `invitee.created` twins | genuine      | the owner's real reschedule                                                                                                                                                         |
| VALID signature verifies                     | genuine      | by consequence: the booking landed AT ALL only because Calendly's own HMAC over its own bytes verified against the SERVER-MINTED key — a bad signature is a 401 that writes nothing |
| TAMPERED body refused                        | **replayed** | Calendly only ever signs what it sends; a bad-signature delivery cannot be ordered from a vendor                                                                                    |
| Redelivery idempotency                       | **replayed** | Calendly retries only on failure — not forceable on demand                                                                                                                          |
| Out-of-order twin redelivery                 | **replayed** | the vendor sends each twin once, in an order it chooses                                                                                                                             |

The replayed proofs are real HTTP against the real deployed endpoint with
correctly computed signatures. What is NOT real is the vendor having sent them.

### Two shipped gaps this walk found

**The ingress was never wired.** `infra/main.bicep` already took
`integrationsWebhookBase`, but `deploy.yml` never passed it — so every deployed
revision fell back to localhost and booking detection could not be armed on
staging at all. The walk's own precondition was a shipped gap. `deploy.yml` now
resolves the api app's FQDN and passes it (the `webAppUrl` pattern).

**The connect DTO refused every real PAT.** The first arm run
([30457209162](https://github.com/tronwebdev/clientforce-platform/actions/runs/30457209162))
got three genuine gates in and then failed with
`{"path":"apiToken","message":"String must contain at most 500 character(s)"}`.
A Calendly PAT is a signed JWT comfortably past 500 chars; the §8 walk drove the
token tier with a short fake behind the stub, so the cap never bound. As shipped,
the token tier — and therefore booking detection — could not be connected by any
real user. Raised to 2000 (still bounded) and pinned by a regression test.
Stripe (500) and HubSpot (200) are untouched: short opaque keys by vendor format,
both already proven with real credentials.

### Arm gates — run [30458855417](https://github.com/tronwebdev/clientforce-platform/actions/runs/30458855417), all genuine, all green

| Gate                            | Result                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------ |
| PAT probe                       | authed as **Clientforce**, `scheduling_url https://calendly.com/clientforce`   |
| Staging API surface             | `GET /integrations/calendly` → 200, workspace `cmqzik46w0002ja2zsc94blyh`      |
| Correlation target              | contact `cmrck3xp60068mz012fz43z4c` · enrollment `f8a09bac-…` · stage `new`    |
| Connect (token tier)            | the DEPLOYED `connect-fields` endpoint → **201** (with the real PAT, post-fix) |
| Server-minted signing key       | 32-byte hex minted server-side, never supplied by the walk                     |
| Subscription create → list      | 1 active, `…/webhook_subscriptions/3cd68c18-90a7-41cd-9e8c-2685ce9e0270`       |
| Callback is the staging ingress | `https://clientforce-api.kindglacier-2a8993f3.westus.azurecontainerapps.io`    |

A staging walk must tolerate a stale deploy — the fix a walk discovers is by
definition not yet deployed. The arm phase detects that exact refusal and falls
back to the shipped connect service in-process, **disclosed in the receipts as
`connectedVia`, never silent**. That disclosure was retired once the deploy
landed: the re-arm went through the deployed endpoint and was idempotent (same
signing key, same capability token, same subscription URI — no duplicate at the
vendor).

### Discipline

- **Writes never bypass the product**: every Meeting/Event/stage row asserted was
  written by the deployed API's own `/webhooks/calendly` off a real delivery. The
  staging DB is opened READ-ONLY for inspection (the worker-health-probe
  precedent); the walk never inserts or updates a Meeting, Event or stage.
- The walk never runs `db:migrate` — staging's schema stays owned by the deploy.
- Zero secrets: the PAT, the server-minted signing key and the capability token
  appear only as short prefixes + lengths in logs and receipts.

### Verify half — NOT YET CAPTURED

The verify phase (twin convergence via `priorExternalIds`, the canceled half
publishing nothing, tombstone idempotency including out-of-order redelivery,
signature verification, teardown) runs after the owner's real booking and
reschedule, and its live frames land here with the run stamp. **Until that row
is filled in, this evidence set proves the arm half only** — the booking
semantics above the line remain the stubbed §8 walk's, not staging's.

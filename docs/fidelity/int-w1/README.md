# INT W1 — Integrations platform core + Slack · §8 evidence (12 build shots + 3 proto twins + delivery receipt, 1440×900)

Canon: `design_handoff_clientforce_restyle/prototypes/Integrations.dc.html`
(card grid · category pills · 460px drawer: connected state + connect wizard).

Every frame is the REAL stack: Postgres 16 + pgvector migrated to branch head,
Redis, api :3001 (nest build), worker (bus consumers live), web :3000
(production build), dev sign-in, seeded demo workspace. **Slack is stubbed at
its HTTP boundary** (the `SLACK_BASE_URL` seam — the SENDGRID_BASE_URL /
ZeroBounce-fixture precedent): the OAuth 302, token exchange, `auth.test`
probe, `conversations.list`, and `chat.postMessage` in these frames are real
HTTP calls answered by a local stub that records posts. Nothing UI-side is
mocked; every state was EARNED through the API/bus. The real-vendor proof
lands with the W4 staging live-proof once the owner's Slack app exists (the
owner clock started at W1 dispatch).

## Frames

| Frame | What it proves |
| ----- | -------------- |
| `proto-integrations-grid` ↔ `build-integrations-grid` | Canon grid anatomy: header + "{n} of {m} connected" + search + category pills + 3-col cards (glyph tile, cat label, desc, footer affordance). Build deltas are HONESTY, not styling: unbuilt providers render owner-readable "Arrives with …" reasons instead of the prototype's working + Connect on all 15; Twilio SMS (REAL, platform-managed) deep-links "Managed in Settings → Channels"; the connected-count counts only LIVE probe-backed connections (0, honestly, vs the prototype's simulated 5). |
| `build-integrations-grid-messaging` | Category filter live: Slack (live) beside WhatsApp (honest-absent) and Twilio (managed) — the three availability states in one frame. |
| `proto-drawer-wizard-auth` ↔ `build-drawer-wizard-auth` | Wizard step 1 per canon (segments bar · "Sign in with Slack" dark button · "Clientforce will be able to" perms). Adaptation (flagged in code): real OAuth leaves the page at the auth step — the prototype's simulated in-drawer connect can't exist honestly. |
| `build-drawer-wizard-channel` | Step 2 AFTER the real OAuth return (`?connected=slack` reopens the drawer): the channel list is a live `conversations.list` through the adapter; toggles default ON per canon. |
| `build-drawer-wizard-summary` | Step 3 "What will sync" from the actual toggle state → "Finish & connect" PATCHes the real config. |
| `proto-drawer-slack-connected` ↔ `build-drawer-connected` | The connected drawer: status pill ("Live · Connected" ONLY because the live `auth.test` probe passed), Connection card (Account = the probe's team name "Demo Agency workspace", Last sync, ● Healthy, ↻ Sync now), What's syncing (channel + the three notification kinds), granted-scopes chips (dispatch requirement, designed addition), Setup timeline all-✓, Disconnect/Settings footer. |
| `build-integrations-grid-connected` | Grid re-renders from the API: "1 of 15 connected", green pulse dot, ✓ Connected + Manage on the Slack card. |
| `build-drawer-activity-notify` + `slack-stub-posts.json` | **The notify walk, end-to-end through the REAL rails:** a real `email.replied.v1` published on the REAL bus → the WORKER's notifier consumer → `chat.postMessage` → the stub's receipt (`"↩ New reply from Ada Lovelace — interested"` → #clientforce-alerts, the JSON in this dir) → `IntegrationDelivery` row → `integration.notified.v1` on the ledger → the drawer Activity trail (designed addition, flagged). The trail also shows the full connect/disconnect/status-transition audit — the ledger OUTLIVES a deleted connection row (the automation.deleted stance). |
| `build-drawer-revoked` | The honest revoked state: the stub flips `auth.test` to `token_revoked` → ↻ Sync now → the row transitions `connected → revoked` (one `integration.status_changed.v1`) → "Disconnected — Slack revoked this token" + Reconnect. Never a fake "connected". |
| `build-drawer-disconnect-confirm` → `build-integrations-grid-after-disconnect` | The disconnect walk: two-click confirm → vendor revoke + row DELETE + `integration.disconnected.v1` → the grid back to an honest "+ Connect". |

## Capture environment & disclosures

- Prototype twins rendered from the canon `.dc.html` with its React/Babel CDN
  dependencies fulfilled from local npm-tarball copies via route interception
  (the r1-ui precedent — the sandbox blocks unpkg); prototype code untouched.
- The wizard's canon step-2 for Slack ("Alerts": channel + per-kind toggles)
  is built verbatim; the prototype's simulated instant-connect is replaced by
  the real OAuth round-trip (flagged adaptation, see the drawer code header).
- The prototype grid shows 5 simulated connections (gmail/gcal/stripe/twilio/
  slack); the build never renders a connection that does not exist — the
  honest-absent/managed treatments are the flagged designed deltas, reasons
  in `apps/web/lib/integrations.ts`.
- `proto-drawer-wizard-auth`'s prototype twin uses the HubSpot card (the
  prototype's Slack defaults to connected); the auth-step anatomy is
  category-generic in the canon (`buildFlow`), so the pair is like-for-like.

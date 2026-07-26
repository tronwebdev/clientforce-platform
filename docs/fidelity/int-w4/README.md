# INT W4 — HubSpot one-way CRM push · §8 evidence (2 proto↔build pairs + real-rails push receipts + the live proof)

Canon: `design_handoff_clientforce_restyle/prototypes/Integrations.dc.html`
(the HubSpot CRM card). W4 is the unit's CRM half. Its **staging live-proof
PASSED** ([run 30200590807](https://github.com/tronwebdev/clientforce-platform/actions/runs/30200590807)
— a real Contact + Deal `512959987899` on `api-eu1.hubapi.com`, portal 148594354;
idempotent redelivery; stage → `closedwon`); the **live build UI frames** are the
one remaining §8 piece and ride that proof on the real local stack (DEC-096 ·
Q-056) — exactly like W1's Slack proof, the wave ships fully built + green with
HubSpot stubbed at its HTTP seam. Seven 2026-07-26 staging runs fixed real
HubSpot facts (all unit-pinned): the **write-only Service Key** handling
(best-effort `/account-info` connect + create-first upsert — the key can't
read/search), the **EU regional host** (`api-eu1.hubapi.com`, derived from the
`pat-eu1-` prefix — the `api.hubapi.com` facade routes EU tokens to the US hublet
→ 401; `api-<region>` HYPHEN, not the NXDOMAIN dot), a deliverable **email**
(HubSpot rejects the `.test` TLD → `example.com`), and the deal↔contact
**association** (the v4 DEFAULT association, best-effort — HubSpot 400s it
`"One or more associations are invalid"` on both v4 shapes and both before/after
the read grant, a per-account/Service-Key permission not a scope, so the deal
delivers UNLINKED; owner shipped deferred, auto-link → Q-056). The evidence here is the **canon twins** + the **real-rails push
walk** (script-fired, the engine + `deliverCrm` + the ledger all real, HubSpot at
the `HUBSPOT_BASE_URL` stub) + the **test-pinned build** (below).

## Two flagged adaptations (owner-visible — the proto twin shows exactly what the canon intended)

The canon `proto-hubspot-drawer.png` ships HubSpot as **(a) an OAuth wizard**
("Step 1 of 3 — Authorize HubSpot → **Sign in with HubSpot**") and **(b)
two-way** ("Read & write contacts · Read & write deals & pipelines",
"Two-way sync of contacts, deals & lifecycle stages"). The build adapts BOTH,
each flagged:

| Axis          | Canon (proto)                                         | Build (this wave)                                                                       | Flag                                                                                                                                                                                                      |
| ------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth**      | OAuth "Sign in with HubSpot" (a public developer app) | the **private-app token** `fields` step (paste a token)                                 | DEC-096 + the #108 plan comment: marketplace framing is OUT (a public OAuth app IS that shape); the W2 Calendly / W3 Stripe-key token precedent; NO owner clock for connect. Owner can override to OAuth. |
| **Direction** | two-way "Read & write"                                | **one-way push** (write-only: `crm.objects.deals.write` + `crm.objects.contacts.write`) | The card desc corrected from "two-way sync" to the honest one-way push; two-way (read HubSpot changes back) re-files → **Q-055**.                                                                         |

This is the `fields`-vs-OAuth adaptation precedent (W2 Calendly, W3 Stripe) —
the build is honestly NARROWER than the canon's two-way claim, and says so.

## Frames + receipts

| Artifact                                    | What it shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proto-integrations-grid.png`               | The canon 15-card grid — the CRM category (HubSpot / Salesforce / Pipedrive). The BUILD flips the `hubspot` card LIVE off core `INTEGRATION_PROVIDERS` (availability derives — zero registry edits; drift-pinned in `apps/web/test/integrations.test.ts`).                                                                                                                                                                                                                                                                                                                                        |
| **`build-integrations-grid.png`** (↔ proto) | **The LIVE build grid** at 1440×900 — the `hubspot` card **"✓ Connected"** (green dot) with the honest ONE-WAY copy ("Push leads into HubSpot as deals & move deal stages from your rules"), "6 of 15 connected", the category pills, and the honest-absent Salesforce/Pipedrive ("Arrives with…").                                                                                                                                                                                                                                                                                               |
| `proto-hubspot-drawer.png`                  | The canon HubSpot drawer — OAuth "Sign in with HubSpot" + two-way "Read & write". The build's adaptation (private-app fields + one-way) is the table above.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **`build-hubspot-drawer.png`** (↔ proto)    | **The LIVE build drawer** — "Live · Connected", **Account: HubSpot (portal 148594354)** (the same portal the live proof pushed to), "Last sync 2m ago", the WHAT'S SYNCING panel ("One-way push — Create CRM deal & Update deal stage rules write to HubSpot; changes are never read back"), the neutralized SETUP copy ("A private-app token **or Service Key** with crm.objects.deals.write + contacts.write"), Disconnect / Settings.                                                                                                                                                          |
| `w4-stub-receipts.json`                     | **The one-way push, end-to-end on the REAL rails:** a `payment_received` rule with `create_crm_deal` fired through the REAL engine → `deliverCrm` upserted the contact (`contact_1`), created deal **`deal_1` "Ada Lovelace"** in pipeline `default`, associated it (v4 default association), and stored the deal id on `Enrollment.meta.crmDealId`. A redelivery **deduped to the same deal** (no second create). Then `update_deal_stage` moved `deal_1` → **`closedwon`**. The run-row details are verbatim: `delivered (deal deal_1 created)` · `delivered (deal deal_1 moved to closedwon)`. |

## Test-pinned build (the UI + behavior the live-proof will re-show visually)

- **Behavior** (green vs real Postgres + RLS): `packages/integrations/test/hubspot.test.ts` (12 — the probe/classification matrix + the push primitives + create-first upsert + the regional-host derivation: EU `api-eu1` · US default · explicit-override precedence) and `crm.integration.test.ts` (6 — the create→store→update roundtrip through the REAL engine, the no-deal refusal, the 401→revoked flip, the create dedupe, the write-only-connect 401 tolerance, and the best-effort-link fallback: a failed association still delivers the deal unlinked, never orphaned).
- **UI/vocabulary**: `apps/web/test/integrations.test.ts` (the `hubspot` card is live off the core union · `DRAWER_CONTENT.hubspot` satisfies the non-Partial Record) · `automation-display.test.ts` (the `create_crm_deal`/`update_deal_stage` chips) · the drawer connect wiring typechecks under `next build`.

## Capture environment & disclosures

- **The HTTP-seam stub** (`hubspot-stub.mjs`, `HUBSPOT_BASE_URL`): a stateful
  in-memory HubSpot (contacts + deals) — the same shape the adapter classifies.
  The walk is script-fired, rails-real (the W2/W3 precedent): the script plays
  only the triggering event; the rule engine, `deliverCrm` (claim-then-send,
  allowance brake, the 401→revoked flip), the association, and the ledger are
  the real code paths.
- **Live build frames captured** (2026-07-26, the W1–W3 pattern): `build-integrations-grid.png`
  - `build-hubspot-drawer.png` at 1440×900 on the REAL local stack — web production
    build (`next start`) + api + PG16 + Redis, dev sign-in as `owner@demo-agency.test`,
    a seeded `hubspot` connection mirroring the live proof (portal 148594354, a
    delivered `crm_deal` for `512959987899` in the activity trail). The connection
    STATE is seeded (this is the UI-state capture); the REAL-vendor push is the
    separate GREEN live proof ([run 30200590807](https://github.com/tronwebdev/clientforce-platform/actions/runs/30200590807)
    — a real Contact + Deal `512959987899` on `api-eu1.hubapi.com`, portal 148594354;
    idempotent; stage → `closedwon`). The builder-with-both-CRM-actions view folds into
    the R1-UI rules-builder §8 set (the `create_crm_deal`/`update_deal_stage` chips are
    pinned in `automation-display.test.ts`). Capture: dev-local Playwright (Chromium at
    the pinned browsers path), script deleted before commit (the G-fidelity discipline).

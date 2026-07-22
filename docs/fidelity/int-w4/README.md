# INT W4 — HubSpot one-way CRM push · §8 evidence (2 proto twins + real-rails push receipts)

Canon: `design_handoff_clientforce_restyle/prototypes/Integrations.dc.html`
(the HubSpot CRM card). W4 is the unit's CRM half; its **staging live-proof is
owner-gated on the HubSpot Private-App clock** (DEC-096), so — exactly like
W1's Slack proof — the wave ships fully built + green with HubSpot stubbed at
its HTTP seam, and the live end-to-end UI frames ride that proof. The evidence
here is the **canon twins** + the **real-rails push walk** (script-fired, the
engine + `deliverCrm` + the ledger all real, HubSpot at the `HUBSPOT_BASE_URL`
stub) + the **test-pinned build** (below).

## Two flagged adaptations (owner-visible — the proto twin shows exactly what the canon intended)

The canon `proto-hubspot-drawer.png` ships HubSpot as **(a) an OAuth wizard**
("Step 1 of 3 — Authorize HubSpot → **Sign in with HubSpot**") and **(b)
two-way** ("Read & write contacts · Read & write deals & pipelines",
"Two-way sync of contacts, deals & lifecycle stages"). The build adapts BOTH,
each flagged:

| Axis | Canon (proto) | Build (this wave) | Flag |
| ---- | ------------- | ----------------- | ---- |
| **Auth** | OAuth "Sign in with HubSpot" (a public developer app) | the **private-app token** `fields` step (paste a token) | DEC-096 + the #108 plan comment: marketplace framing is OUT (a public OAuth app IS that shape); the W2 Calendly / W3 Stripe-key token precedent; NO owner clock for connect. Owner can override to OAuth. |
| **Direction** | two-way "Read & write" | **one-way push** (write-only: `crm.objects.deals.write` + `crm.objects.contacts.write`) | The card desc corrected from "two-way sync" to the honest one-way push; two-way (read HubSpot changes back) re-files → **Q-049**. |

This is the `fields`-vs-OAuth adaptation precedent (W2 Calendly, W3 Stripe) —
the build is honestly NARROWER than the canon's two-way claim, and says so.

## Frames + receipts

| Artifact | What it shows |
| -------- | ------------- |
| `proto-integrations-grid.png` | The canon 15-card grid — the CRM category (HubSpot / Salesforce / Pipedrive). The BUILD flips the `hubspot` card LIVE off core `INTEGRATION_PROVIDERS` (availability derives — zero registry edits; drift-pinned in `apps/web/test/integrations.test.ts`). |
| `proto-hubspot-drawer.png` | The canon HubSpot drawer — OAuth "Sign in with HubSpot" + two-way "Read & write". The build's adaptation (private-app fields + one-way) is the table above. |
| `w4-stub-receipts.json` | **The one-way push, end-to-end on the REAL rails:** a `payment_received` rule with `create_crm_deal` fired through the REAL engine → `deliverCrm` upserted the contact (`contact_1`), created deal **`deal_1` "Ada Lovelace"** in pipeline `default`, associated it (v4 default association), and stored the deal id on `Enrollment.meta.crmDealId`. A redelivery **deduped to the same deal** (no second create). Then `update_deal_stage` moved `deal_1` → **`closedwon`**. The run-row details are verbatim: `delivered (deal deal_1 created)` · `delivered (deal deal_1 moved to closedwon)`. |

## Test-pinned build (the UI + behavior the live-proof will re-show visually)

- **Behavior** (green vs real Postgres + RLS): `packages/integrations/test/hubspot.test.ts` (9 — the probe/classification matrix + the push primitives) and `crm.integration.test.ts` (4 — the create→store→update roundtrip through the REAL engine, the no-deal refusal, the 401→revoked flip, the create dedupe).
- **UI/vocabulary**: `apps/web/test/integrations.test.ts` (the `hubspot` card is live off the core union · `DRAWER_CONTENT.hubspot` satisfies the non-Partial Record) · `automation-display.test.ts` (the `create_crm_deal`/`update_deal_stage` chips) · the drawer connect wiring typechecks under `next build`.

## Capture environment & disclosures

- **The HTTP-seam stub** (`hubspot-stub.mjs`, `HUBSPOT_BASE_URL`): a stateful
  in-memory HubSpot (contacts + deals) — the same shape the adapter classifies.
  The walk is script-fired, rails-real (the W2/W3 precedent): the script plays
  only the triggering event; the rule engine, `deliverCrm` (claim-then-send,
  allowance brake, the 401→revoked flip), the association, and the ledger are
  the real code paths.
- **Deferred to the owner-gated live-proof** (the W1 pattern): the live build UI
  frames (the fields wizard, the connected portal/pipeline drawer, the builder
  with both CRM actions) + the run-row rendered in the Automations drawer ride
  the staging proof once the HubSpot Private-App token exists (drop it in the
  drawer or the vault as `HUBSPOT-DEMO-TOKEN`). The build is complete and green
  now; only the real-vendor frames wait on the token.

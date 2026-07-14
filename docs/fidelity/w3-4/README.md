# W3-4 — Agent-view sequence editor · §8 evidence (22 shots, 1440×900)

Canon: `Campaign View.dc.html` Steps tab (the dashboard target — sequence
cards, add-step popover, per-channel step editor drawer, inline delay pill)
with `Create Agent.dc.html` step 2 as the drawer/brief anatomy anchor
(G1/G2/G3 built surfaces — the brief editor and Scripted|✦ Guided control
anatomies are reused verbatim from the shared component, never re-shot as
new canon; see `docs/fidelity/g3/` for those prototype pairs).

## Frames

| Frame | What it proves |
| ----- | -------------- |
| `proto-steps-sequence` ↔ `build-steps-editable-default` | The editable Steps tab: sequence cards with the canon green **✎ Edit** link, delay pills, dashed **+ Add step**, schedule chip — plus the flagged additions: reorder ↑↓, **✦ Regenerate** (Create Agent canon extension) and the **DEC-076 live-graph banner** ("Changes apply to new contacts and upcoming steps — contacts mid-sequence finish on the current version"). |
| `proto-steps-add-picker` ↔ `build-steps-add-picker` | The anchored 236px "Choose a step type" popover. Build: Email + SMS live (SMS gated on the workspace's ACTIVE Twilio sender, DEC-061), WhatsApp/Voice rendered with the honest capability disclosure — never a dead pick (canon lists all four as pickable). |
| `proto-step-editor` ↔ `build-steps-drawer-scripted` | The 560px step editor drawer — the SHARED wizard component on the dashboard: subject/body, deterministic deliverability rows, personalization tokens, **Save step** footer; plus the W3-4 props: per-step mode control strip, DEC-076 notice, red **Delete step** (designed addition — the sub-campaign drawer's red-action anatomy). |
| `proto-delay-editing` ↔ `build-steps-delay-editing` | Inline delay editing per Campaign View canon: pill → **⏱ Wait − N day +  Done**, clamp 1–30. The Done write persisted a MANUAL version through the edit gate (v-bump visible in later frames). |
| `build-steps-reordered` | ↑ on step 2 — the entry follows the new head, ids stable (stats/idempotency contract), persisted as the next MANUAL version through the gate. |
| `build-settings-regen-deeplink` | The Settings composeMode footnote now deep-links to the Steps tab's Regenerate — the W3-12 inert-toggle gap closed. |
| `build-steps-flip-guided-seeded` | W2: scripted→guided flip — the control flips, the brief editor opens with the DETERMINISTIC seed (objective from the step's M1a arc role, subject → subject hint, body sentences → talking points), every seeded value **✦ AI-picked**-marked. The seed is honestly INCOMPLETE (2 of 6, min 3) — nothing fabricated; the floor holds until the owner adds material. |
| `build-steps-flip-guided-composed` | The seed completed with one owner-typed point → the ONE-STEP COMPOSE: the STAGED brief through the real sandbox composer (`composer.email@v1`, real deterministic checks) — subject from the hint, Jane/Acme personalization, mustSay verbatim. |
| `build-steps-sample-refused` + `build-steps-invalid-guided-edit` | The refusal pair, one frame each: a REAL composer refusal (`NEVER_SAY_VIOLATION — contains banned phrase(s): "Worth knowing"` — the fake model includes mustSay lead-ins; the real check catches the ban) and the honest invalid-edit refusal in the drawer footer ("Add at least 3 talking points…"). Nothing persisted on either. |
| `build-steps-guided-cards` | Agent B (guided-planned, launched): guided email + guided SMS cards (✦ Composed at send + per-channel credits), reorder arrows, ✎ Edit on every card, the **✦ Regenerate to apply** mismatch affordance, live banner. |
| `build-steps-brief-editor-email` / `build-steps-brief-editor-sms` | Brief EDITING on the dashboard — the wizard brief editor verbatim (objective · email-only subject hint w/ rules note · talking points min-3 · must/never chips · sample panel). SMS variant carries no subject hint (G2 layer-2 rule). |
| `build-steps-sample-composed` | Sample panel in the dashboard brief editor — composes the STAGED brief (what the owner sees) through the real rails. |
| `build-steps-flip-scripted-empty` → `build-steps-flip-scripted-drafted` | W2: guided→scripted honest path — the empty-copy note with **✦ Compose a draft**; after one sandbox compose the drafted subject + body render **✦ AI-picked**-marked until edited or confirmed. Save blocks until body copy exists — no dead state. |
| `build-steps-chain-and-absence` | W3: the reply-strategy group chain-true — per-intent chains with per-chain indented dashed **+ Add step**, ✎ Edit per chain step; and the **Add a sub-campaign** canon card rendered with the honest R1-gate disclosure ("Arrives with automation rules — its triggers use the same When→If→Then vocabulary"). |
| `proto-branches-subcampaigns` | The canon Branches view (sub-campaign cards + Add-a-sub-campaign) — the anchor for the honest-absence card and the (deferred) Branches sub-tab composition. |

## Capture environment & disclosures

- **Real local stack:** Postgres 16 + pgvector (RLS role `clientforce_app`),
  Redis, api :3001 (`node dist/main.js`), web :3000 (production build), dev
  sign-in, seeded demo workspace. Every edit was driven through the REAL
  UI → `PUT /planner/graph` three-layer gate; every version bump is a real
  MANUAL row.
- **The model is a deterministic prompt-driven fake over
  `ANTHROPIC_BASE_URL`** (the G1/G2/G3 discipline — personalizes only from
  the prompt's LEAD block, includes the prompt's Must-say strings verbatim;
  no network AI) — so the real gateway → composer → deterministic checks →
  compose-preview paths ran end-to-end, including the staged-brief variant
  and the NEVER_SAY refusal.
- **Seeded fixtures (disclosed):** both agents' graphs are planner-SHAPED
  fixture rows validated with the real `validateGraph` before insert
  (the M1b/G3 precedent); agent B's guided v2 + multi-step strategy chain
  stand in for planner output (the real scripted-v5/guided-v7 selection is
  pinned by the planner suites); agent-layer BusinessContext rows are typed
  fixtures shaped as the distiller persists them. Agent A carries one
  ACTIVE enrollment (`meta.graphVersion: 1`) as the mid-sequence pin.
- Prototype served from the repo file over localhost; its unpkg React/Babel
  deps fulfilled from npm-registry tarball copies via Playwright route
  interception (C2.2 vendoring precedent); Google Fonts loaded live through
  the session proxy. Prototype file untouched.
- **Versioning + gate proof beyond the frames:** `apps/api/test/`
  `sequence-editor.e2e.spec.ts` (committed, DB-gated) — 8/8 against real
  Postgres+RLS: contact A's pinned workflow input stays v1 (+ meta audit)
  while the edit lands v2; contact B starts on v2 and the executor walks the
  added + flipped steps; playbook-regression edits 422 with the precise
  reason and persist nothing; the repair pass reports each deterministic fix.
  Temporal's ephemeral test server is unavailable in this session's
  environment (download 403) — the durable walk itself is the standing
  workflows integration coverage + the G1/G2 live proofs; **this unit
  changed zero send-path code** (no activities/adapter/boundary edits).
- Capture seed + Playwright scripts + the fake model server were dev-local
  and never committed.

## Deviations (logged in PROGRESS.md, DEC-076)

- **Reorder + delete have no prototype canon** (neither file has any such
  affordance) — designed additions: ↑↓ text glyphs on cards; red
  "Delete step" in the drawer footer (sub-campaign-drawer red-action anatomy).
- **The per-step mode control has no canon** (Create Agent's control is
  sequence-level) — designed addition reusing the G3 segmented-control
  anatomy in a drawer header strip.
- **✦ Regenerate on the Steps tab** is a Create Agent canon extension
  (Campaign View has no regenerate affordance); carries the G3 mismatch
  label semantics unchanged.
- **Add-step picker**: canon offers WhatsApp/Voice as live picks and
  auto-appends with an EMPTY body; the build discloses non-live channels
  honestly and seeds sendable copy (the wizard's add-step seed) because the
  edit gate refuses to persist an unsendable scripted step.
- **Steps tab keeps the G3 single-list composition** (strategy group +
  honest-absence card) rather than the canon's Sequence/Branches sub-tabs —
  the Branches sub-tab view (dark flow card + sub-campaign grid) arrives
  with R1's rules UI, which owns most of that surface.
- Carried-over G1/G2 drawer deltas remain as logged in DEC-075 (credits chip
  placement in the explainer note; sample lead Jane Doe · Acme Dental per
  DEC-070(6)).

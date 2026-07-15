# G-fidelity — guided display round · §8 evidence (12 shots, 1440×900)

Canon: `design_handoff_clientforce_restyle/prototypes/Create Agent.dc.html`
(wizard step 2 — unchanged by the 2026-07-15 re-upload beyond scrubbed
artifacts) and the **2026-07-15 `Campaign View.dc.html`** (the re-pull that
adds the Steps-tab guided model — the missing surface canon behind defect B:
header `Scripted | ✦ Guided` control, guided explainer banner, per-card
`✦ Composed at send` / `✦ AI draft` tags with the one-line `Objective:`
preview).

The three owner-reported defects shared one root cause — card display read
the stored step copy, never the `composeMode` rider. Every "after" frame
below renders from the fixed display resolver; both mode flips were driven
through the REAL controls and DB-asserted (`guardrails.composeMode`)
between frames. DEC-075 Regenerate-to-apply semantics untouched.

## Frames

| Frame | What it proves |
| ----- | -------------- |
| `proto-wizard-step2-scripted` ↔ `build-wizard-step2-scripted` | Baseline: scripted control state, scripted cards with copy + "✦ AI draft", no banner. |
| `proto-wizard-step2-guided` ↔ `build-wizard-step2-guided-pending` | **Defect A fixed.** The flip through the real control (PATCH persisted, DB-asserted): cards render `Objective: <arc-role seed>` + **✦ Composed at send** + per-channel credits — never the scripted body — while the banner carries "These steps were planned as scripted — hit ✦ Regenerate to apply guided composing." and the button reads **✦ Regenerate to apply** (locked semantics visible, not changed). The four objectives walk the M1a arc (OPENER → VALUE → OBJECTION-PREEMPT → BREAKUP) — the arc invariant, visible. |
| `build-wizard-step2-guided-tabswitch` · `build-wizard-step2-guided-reload` | **Defect C fixed.** Main sequence ⇄ Branches & rules and a full reload: the Guided pill stays selected (hydrated from the stored rider) and the cards stay guided — the choice is visibly locked in. |
| `proto-steps-guided` ↔ `build-steps-tab-guided-pending` | **Defect B fixed + the new canon control.** The agent-view Steps tab: canon `Scripted \| ✦ Guided` control (flip DB-asserted through it), guided explainer banner with the pending mismatch line, every email/SMS card `Objective:` + ✦ Composed at send — zero scripted bodies. |
| `proto-steps-scripted` ↔ `build-steps-tab-scripted` | Steps-tab baseline: Scripted selected, copy previews, no tags, no banner (canon: tags render only under guided). |
| `build-steps-tab-guided-reload` | Persistence on the dashboard: the pill + cards survive a full reload straight from the store. |
| `build-steps-tab-mixed` | The MIXED truth state (deliberate per-step choices, W3-4 W2): real-brief cards keep the G1/G2 anatomy (objective title · subject hint · bullets) with ✦ Composed at send + credits; the deliberately-scripted steps keep their copy tagged **✦ AI draft** (canon `hasModeTag` mapping); banner without the mismatch line; button back to ✦ Regenerate with AI. No pending treatment — baked truth wins. |

## Capture environment & disclosures

- Real local stack: Postgres 16 + pgvector, Redis, api :3001, web :3000
  (production standalone build), dev sign-in, seeded demo workspace. Both
  mode flips were driven through the REAL controls and their PATCHes
  DB-asserted before the next frame; the flip-back walk (guided → scripted
  restores copy) was live-verified during development.
- **Seeded fixtures (disclosed):** three agents with planner-SHAPED graphs
  validated by the real `validateGraph` before insert (g3/M1b/W3 precedent) —
  a DRAFT scripted 4-step email+sms playbook graph (wizard frames), an ACTIVE
  twin for the Steps-tab flip, and an ACTIVE mixed graph (steps 2/3 guided
  with real briefs). No plan worker ran locally; the real scripted-v5/
  guided-v7 planner selection is pinned by the planner suites and the G1/G2
  live proofs. Worker heartbeat written by the capture supervisor (M1a
  precedent) so the degraded-environment banners never contaminate a frame.
- Prototypes served from repo files over localhost; unpkg React 18.3.1 UMD
  fulfilled from local npm-registry tarball copies and Google-Fonts CSS
  replaced with the BUILD's own self-hosted Bricolage woff2 via Playwright
  route interception (C2.2/g3 vendoring precedent — the proxy blocks both;
  prototype files untouched; body text falls back to sans exactly like the
  build). Capture seed + Playwright scripts were dev-local and deleted
  before commit.

## Deviations (logged in PROGRESS.md, DEC-086)

- REAL-brief card bodies keep the G1/G2-accepted objective-title + bullets
  anatomy vs the canon's one-line `Objective:` preview — the carried-over
  delta (DEC-075), restated for the dashboard; PENDING cards render the
  canon one-liner.
- The dashboard keeps the wizard-shared per-send credits chips, the
  ✦ Regenerate button and the DEC-076 live-graph banner — designed
  additions the Campaign View canon doesn't carry.
- The guided banner drops the canon's "WhatsApp templates and voice scripts
  stay as written." sentence — the build plans email + SMS only this phase
  (DEC-075 honest absence, restated).
- Prototype demo literals (5 steps · 4 channels, WhatsApp/Voice steps,
  summary-band figures) are data-driven in the build; the canon's goal chip
  + summary band + goal-label map belong to the W3-5 / C2.9 threads.

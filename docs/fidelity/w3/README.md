# W3 §8 evidence — wizard fidelity round (steps 3 · 4 · 6), PR #85

All frames 1440×900 against `Create Agent.dc.html` (the 2026-07-11 canon).
`proto-*` = the interactive prototype; `build-*` = this branch. Deviations
are DEC-073 (each honest-state divergence listed there and below).

| Pair / shot | What it proves |
| --- | --- |
| `proto-step3-default` ↔ `build-step3-empty` · `build-step3-list-picked` | W3-7 audience preview card: header + count pill + member rows + "+ N more" footer; the build's empty frame is the honest before-any-source state (designed, no proto anchor for empty), the picked frame shows the real list (8 members, live count) |
| `build-step3-goal-tags` | W3-10 step-3: existing-audience goal (reactivate) → "FOR THIS GOAL" tags + soft-green border on Upload CSV + Choose a list; doubles as the audience-empty + disabled-Next frame |
| `proto-list-picker` ↔ `build-list-picker` | 480px picker anatomy; the build lists the four REAL seeded lists with live counts |
| `proto-manual-drawer` ↔ `build-manual-drawer` | W3-8 drawer anatomy (form card · initials chips · per-row Remove · "N contacts ready to add" footer), two really-queued rows |
| `build-step3-manual-added` | W3-8→W3-7: drawer adds LAND in the preview (count 8→10, rows carry name · email · company) |
| `proto-csv-upload/mapping/review/done` ↔ `build-csv-*` | W3-1: the REAL C2.5 3-step import as a modal OVER the step (setup visible underneath); auto-matched mapping; snapshot tiles (10 new · 1 dupe · 0 suppressed · 4 mapped — the clinic column honestly auto-skips); the wizard-mount "＋ New list "lapsed-clients-q3"" default; the done modal shows the SERVER's counts (C2.5 copy kept — the wizard proto's "enrolled in this campaign" would be false before launch, DEC-073) |
| `build-step3-csv-picked` | W3-1 audience by reference: the Upload-CSV card flips to the created list (name + live count re-resolved from GET /lists), audience total re-sums |
| `proto-step4-default` ↔ `build-step4-default` | W3-9 anatomy: master card · AP card (2px #35E834, Recommended, params w/ the proto's literal option lists, signal pills) · dark panel. Honest deltas: keywords start EMPTY (proto chips are sample data), panel header "· on" not "· live", panel body = matches-after-launch (proto's found-leads rows are mock) |
| `proto-step4-keywords-open` ↔ `build-step4-keywords-open` | "Suggested keywords" dropdown — the build's suggestions DERIVE from the agent's own typed context (icp/services/offer) + the flagged type-your-own row |
| `proto-step4-asset-menu` ↔ `build-step4-asset-menu` | Inbound asset picker: expanded card + select; the build renders the honest "No saved widgets yet" + ＋ Create-new path to the nav stub — never the proto's sample assets |
| `proto-step4-preview-empty` ↔ `build-step4-ap-off` | AP toggled off → dashed 👁 "Nothing to preview yet"; the build additionally collapses the AP config (W3-10 owner direction — the proto keeps it open) |
| `build-step4-not-typical` | W3-10 existing-audience: AP defaults OFF · badge "Not typical for this goal" · in-card goal note (♻ + one line) · config collapsed |
| `build-step4-automations-prospecting` · `-reactivate` | W3-10 suggested-automations strip (designed): the two static template pairs, CTAs → /integrations · /automations |
| `build-step4-master-off` | master toggle off → everything below dims + disables (designed state; the proto draws only on) |
| `proto-step6-default` ↔ `build-step6-ready` · `build-step6-cost-strip` | W3-3 anatomy at the proto scale (4-up tiles 12.5/600 + 16/700 · Lead capture card · Guardrails card · Estimated cost card · launch strip). The estimate is COMPUTED: 20 contacts × 3 email steps × 1 credit = 60; AP + enrichment as per-lead rates while AP is on; "Total to launch 60 credits"; the strip carries the readiness line + 🚀 Deploy (no ledger exists — Q-020 — so the proto's balance sentence is replaced, logged) |
| `build-step6-unresolved` · `-strip` | The amber gate variant: 6 unresolved gaps line + disabled Deploy (rail AND strip); also the AP-off estimate (no per-lead lines — honest absence) |

## Capture environment & disclosures (DEC-073)

- Real local stack: Postgres 16 + pgvector, Redis, `apps/api` (:3001),
  `apps/web` production build (:3000), dev sign-in as
  `owner@demo-agency.test` in the seeded demo workspace. Every interaction
  above ran through the REAL UI + API (list pick, manual adds, the CSV
  import's transactional `POST /contacts/import`, the Next-path guardrails
  PATCH).
- **No model ran locally.** The two DRAFT agents were seeded mid-wizard
  (B6 `?agent=` resume, the L1 precedent) with planner-SHAPED graph
  fixtures (byte-shaped as P1.4 emits — the M1b/G2 fixture discipline) and
  TYPED context answers (the real no-AI resolution path), so the gap
  report's launch-ready state is genuine. The amber variant is the same
  agent with its agent-layer context rows cleared (SQL, disclosed).
- A dev-local heartbeat writer kept the B1 worker banner honest-quiet
  (M1a precedent); an ACTIVE CF_MANAGED sender row was seeded so step 5's
  gate passes (no sends occur — nothing launches in capture).
- The prototype was served from a sandbox COPY with its CDN deps (React /
  Babel / Google fonts) vendored locally — repo prototype files untouched
  (C2.2 precedent).
- Capture seed + Playwright scripts were dev-local and deleted before
  commit (standing rule).

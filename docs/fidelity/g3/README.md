# G3 — Guided-mode visibility · §8 evidence (12 shots, 1440×900)

Canon: `design_handoff_clientforce_restyle/prototypes/Create Agent.dc.html`
(2026-07-11 revision — updated in this PR; the pre-G3 repo copy predated the
guided surfaces). Waves 2/3 surfaces are designed (no prototype anchor for the
dashboard Steps tab or the Inbox marking — the canon's rule is that the
dashboard mirrors the wizard's card/brief treatment; the wizard drawer frame
is the anatomy anchor).

## Frames

| Frame | What it proves |
| ----- | -------------- |
| `proto-step2-scripted` ↔ `build-wizard-step2-scripted` | Toolbar composition: schedule chip · **Scripted \| ✦ Guided** segmented control (canon literals) · ✦ Regenerate with AI. Default scripted, no banner, scripted "✦ AI draft" cards. |
| `proto-step2-guided` ↔ `build-wizard-step2-guided-mismatch` | The flip, driven through the REAL control (PATCH persisted — DB-asserted `guardrails.composeMode = "guided"` during capture): guided explainer banner + **"These steps were planned as scripted — hit ✦ Regenerate to apply guided composing."** and the Regenerate button reading **✦ Regenerate to apply** over the still-scripted v1 cards (mode applies at the next plan — one semantics with Settings). |
| `proto-step2-guided` ↔ `build-wizard-step2-guided-planned` | The guided-planned state (graph v2): banner without the mismatch line, button back to ✦ Regenerate with AI, guided cards with ✦ Composed at send + per-channel credits + objective/subject-hint/bullets, control hydrated guided from the rider on resume. |
| `build-steps-tab-guided` | Steps tab, mixed sequence: guided cards carry the canon treatment + **View brief ›**; the scripted step-1 card unchanged; branch pill intact. |
| `proto-brief-drawer` ↔ `build-steps-brief-viewer` | The READ-ONLY brief drawer on a **launched** agent: wizard-drawer anatomy as display values (note · objective · subject hint w/ rules note · talking points · must/never chips) + the honest read-only footer ("briefs are edited in campaign setup; editing a launched sequence arrives with the sequence editor" — no dead buttons). |
| `build-steps-brief-viewer-preview` | Sample preview in the read-only drawer — REAL `POST /planner/compose-preview` through the REAL deterministic checks (subject + Jane/Acme-personalized body, mustSay included), plus the honest count-only sends line ("1 message sent from this brief…"). |
| `build-steps-brief-viewer-draft` | The DRAFT variant: footer is a REAL **✎ Edit in campaign setup** link (wizard resume); "No sends from this step yet."; empty must/never section honestly absent. |
| `build-inbox-composed-marking` | Inbox thread: the scripted outbound renders UNMARKED above the guided outbound carrying **✦ Composed** on its header row — provenance from the real send-boundary meta, never inferred. |
| `build-inbox-composed-line` | Same thread scrolled: the mode line **"composed from brief · checked against your rails"** under the composed bubble. |

## Capture environment & disclosures

- Real local stack: Postgres 16 + pgvector, Redis, api :3001, web :3000
  (production build), dev sign-in, seeded demo workspace. Every wizard/drawer/
  inbox interaction was driven through the REAL UI/API (the mode flip's PATCH
  was DB-asserted before the next frame).
- **The model is a deterministic prompt-driven fake served over
  `ANTHROPIC_BASE_URL`** (G1/G2's exact discipline — personalizes only from
  the prompt's lead block, includes the prompt's Must-say verbatim; no network
  AI), so the REAL gateway/composer/checks/api paths ran end-to-end for the
  compose-preview frame.
- **Seeded fixtures (disclosed):** both agents' graphs are planner-SHAPED
  fixture rows validated with the real `validateGraph` before insert (M1b/W3/L1
  precedent — the real scripted-v5/guided-v7 planner selection is pinned by the
  planner suites and the G1/G2 live proofs); agent B's guided v2 stands in for
  the regenerate result (no worker ran locally — a live regenerate through the
  queue needs the plan worker, which the §8 stack doesn't run). Agent A's
  thread rows (scripted meta / guided meta / interested inbound) and its
  agent-layer BusinessContext (typed fields) are SQL fixtures shaped exactly as
  the boundaries persist them. Worker heartbeat written by the capture
  supervisor (M1a precedent).
- Prototype served from the repo file over localhost; its unpkg React/Babel
  deps fulfilled from local npm-tarball copies via Playwright route
  interception (C2.2 vendoring precedent — the proxy blocks unpkg; prototype
  file untouched by the capture).
- Capture seed + Playwright scripts + the fake model server were dev-local and
  deleted before commit.

## Deviations (logged in PROGRESS.md, DEC-075)

- Banner copy drops the canon's "WhatsApp templates and voice scripts stay as
  written." sentence — the build plans email + SMS only this phase (honest
  absence over prototype literal).
- Carried-over G1/G2 drawer deltas (pre-G3 surfaces, noted for the W3-4
  editor pass): the canon puts the per-send credits chip on the Objective
  label row — the built drawer carries credits inside the explainer note; the
  canon's sample lead reads "Maya Torres · Hilltop Smiles" — the build keeps
  G1's pinned "Jane Doe · Acme Dental" (DEC-070(6)).
- The canon guided card previews `Objective: <objective>` as one line; the
  built G1/G2 card (wizard + Steps tab) renders objective as the title plus
  subject-hint/bullet lines — pre-existing accepted treatment (G1/G2 §8).

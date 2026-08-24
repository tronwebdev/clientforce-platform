# design_handoff_console_v3 — Console **Bold** port package
Goal: 1-to-1 parity port of the Bold console into apps/web WITHOUT breaking shipped surfaces. Same package shape as design_handoff_clientforce_restyle/.

> **Start with `ADDENDUM_4_BOLD.md`.** The console was rebuilt as **Console Bold** (2026-08-16); `Clientforce Console.dc.html` is retired as pixel truth and now sits in `prototypes/legacy/`. Addendum 4 is the newest document and wins every conflict.

## Read order
1. MIGRATION_NON_BREAKING.md — the contract (flags, additive-only API, wave order)
2. DESIGN_TOKENS_V3.md — atoms (this doc wins on atoms; **read §Bold at the foot**)
3. **ADDENDUM_4_BOLD.md** — the current shell, composition and first-run truth
4. **SURFACE_SPECS_BOLD.md** — per-surface states/interactions/data for Bold (supersedes SURFACE_SPECS.md where they overlap)
5. **DECISION_LOG_BOLD.md** — every ruling and the alternative it rejected. Read before proposing an "improvement"
6. SURFACE_SPECS.md — v3-era specs, still valid for surfaces Bold did not recompose
7. BACKEND_TOUCH_MAP.md — per-surface wiring: EXISTS / EXTEND / NEW (+ Addendum 4 §8)
8. prototypes/ — THE pixel truth (support.js sits beside them; open each, click everything):
   **Console Bold.dc.html (the console — port this one)** · Agent Widget v3 - Mock.dc.html (customer embed) ·
   Business Core Onboarding.dc.html (auth → 6-step Core → plan + card capture) ·
   Clientforce Account.dc.html (AGENCY suite: home, two-path setup, sub-accounts, websites tab, selling tools, earnings/Stripe, reports) ·
   Clientforce Agency Website.dc.html (DFY agency site: full pages, booking, conversion blocks — setup templates = color/font/style variants + preview links) ·
   Clientforce Client Portal.dc.html (client view: outcomes, report, appointments, comments, approvals, magic link) ·
   legacy/Clientforce Console.dc.html (RETIRED v3 console — consult only for questions Bold does not answer; never a style reference).
6. CONSOLE_V3_CANON.md + CONSOLE_V3_BUILD_NOTES.md — decision log behind every surface.

## Parity method (UI_PORTING_RULES.md applies verbatim)
- Atoms (color/type/spacing/radius): token doc wins.
- Composition/behavior/copy: the PROTOTYPE wins — port what it does, not what seems nicer.
- Conflicts: log in PROGRESS.md (DEC/Q), never silently choose.
- Fidelity checkpoints per PHASE1_FIDELITY_CHECKPOINTS.md: per-surface screenshot pairs (proto vs port) attached to each PR.

## What is NEW product (needs endpoints) vs SKIN
Skin/recomposition: campaign console, contacts, forms, chatbot, proposals, automations, integrations, analytics, settings/business, inbox — all rebuilt on SHIPPED vocabulary (campaign-rules.ts, senders.controller, integrations registry, RBAC enum).
NEW product surfaces (additive endpoints listed in BACKEND_TOUCH_MAP §NEW): lead-finder scouts · receptionist add-on · **Ads Closed Loop add-on (Addendum 3)** · client portal (comments/approvals) · agency suite (sub-accounts UX, websites, selling tools, earnings/Stripe) · guided-build (gb) session engine · tour/checklist/help · closer-artifact policy.

## Addenda (read in order, newest wins on conflict)
- **ADDENDUM_2_CREDITS_VALUE.md** (2026-08-15) — credits/billing system, campaign value model, workspaces redesign.
- **ADDENDUM_3_ADS_LOOP_UI.md** (2026-08-15, later) — Ads Closed Loop add-on surface (showcase / in-page setup / 8-tab connected view / 90s film), the **$49-covers-both pricing correction**, Settings & Business core header, and the flex:none detail-pane defect every porter will hit.
- **ADDENDUM_4_BOLD.md** (2026-08-16) — **the console rebuild.** Bold shell contract, rail/dock/canvas composition, 18 surfaces, 10 goal types, Site agent as a channel, first-run flow with card capture, agency/portal skin, the five defects found while building, backend delta and the B0–B11 wave map. **Newest — wins over everything above.**

## Dispatch prompts
**PROMPT_BOLD_PORT_KICKOFF.md** (current — B0→B11, ready to send) supersedes PROMPT_V3_PORT_KICKOFF.md and PROMPT_V3_W0_W1_KICKOFF.md.
PROMPT_V3_W11_ADS_LOOP_KICKOFF.md still stands for the ads product wave (renumbered B11; needs B8 first).

## Bold-era document set (written 2026-08-16)
`ADDENDUM_4_BOLD.md` (what changed + wave map) · `SURFACE_SPECS_BOLD.md` (per-surface contract) · `DECISION_LOG_BOLD.md` (rulings + rejected alternatives) · `DESIGN_TOKENS_V3.md §Bold` (shell metrics, elevation, type scale, wells) · `PROMPT_BOLD_PORT_KICKOFF.md` (dispatch).
The v3-era docs (CANON, BUILD_NOTES, SURFACE_SPECS, BACKEND_TOUCH_MAP) are **not** retired — they hold the semantics, the shipped-vocabulary mapping and the decision history behind everything Bold inherited. They simply predate the Bold shell.

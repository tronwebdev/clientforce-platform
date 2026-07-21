# R1-UI — Automations surface · §8 evidence (14 shots, 1440×900)

Canon: `design_handoff_clientforce_restyle/prototypes/Automations.dc.html`
(list · drawer · 740px builder). This set covers **W1 + W2 together** — the
W1 capture was lost with the terminated container (session resume, see PR
#105), so the W1 states (empty · list · toggle walk · drawer) are captured
here alongside the W2 builder matrix, all against the current branch.

The builder is a RENDERER of the engine's typed vocabulary: expressible
picker entries derive from the core unions; canon entries the engine can't
express render honest-absent (dashed, disabled, reason naming the future
capability — the Q-030+ ledger). Every save in these frames went through the
REAL API (`automationWriteSchema` + the write guards) — including the 422.

## Frames

| Frame | What it proves |
| ----- | -------------- |
| `build-automations-empty` | W1 honest empty state on the fresh seed (canon copy, live "+ New automation"). |
| `proto-automations-list` ↔ `build-automations-list` / `build-automations-list-one` | Canon list anatomy: When→Then summary cards (trigger chip · action chips · runs · status pill · toggle), segment tabs. Build rows are REAL rules created through the builder in this session. |
| `build-automations-toggle-paused` | The enable/disable walk — first card flipped to Paused through the real PATCH (optimistic-until-confirmed). |
| `build-automations-drawer` | W1 drawer with the W2 seams LIVE: ✎ Edit automation + "+ Add an action" active, ledger-sourced Recent runs (honest none-state). |
| `proto-builder-blank-recipes` ↔ `build-builder-blank-recipes` | Blank + new: recipes grid → "or build from scratch" → grouped trigger picker with search. First absent entries visible (Reply received · Inbound message · Email bounced · Spam complaint) — dashed, disabled, reasons inline. |
| `build-builder-trigger-picker-tail` | The deep honest-absent ledger: Forms & widget (lead_captured expressible beside absent Widget chat) · LinkedIn · Proposals & revenue · Schedule & system — every canon entry the engine can't express, each with its "Arrives with …" reason. |
| `proto-builder-configured` ↔ `build-builder-recipe-configured` | Recipe-seeded state. Canon "Reply received + Reply-sentiment filter → Mark qualified + Notify #sales" renders in the build as the DEC-091 vocabulary: `reply_classified` with the intent multi-pick (tinted chips, one intent vocabulary), `set_stage` (Stage + Label) + `notify_team` (Note) — the folding documented in the plan, never a parallel enum. |
| `build-builder-action-picker` | "Choose an action" panel: search + canon groups; all seven **Send a message** entries honest-absent BY DESIGN ("sending rides campaign sequences today" — the no-send-path decision, visible). |
| `build-builder-dup-422` | The dup refusal INLINE from the real API: an equal-trigger twin refused 422, detail verbatim — "“Qualify hot replies” already fires on this exact trigger — edit that one, or change the trigger". Never a silent overwrite. |
| `build-builder-edit-mode` | Drawer → ✎ Edit: the builder hydrated from the stored row (name, trigger config, actions), Save changes label. |

## Capture environment & disclosures

- Real local stack: Postgres 16 + pgvector (migrated to branch head), Redis,
  api :3001 (nest build), web :3000 (production build), dev sign-in, seeded
  demo workspace. No mocked UI states: every rule in frame was created
  through the builder against the live API; the 422 frame is the API's real
  refusal; the toggle frame is the real PATCH.
- Prototype twins rendered from the canon `.dc.html` with its React/Babel
  CDN dependencies fulfilled from local npm-tarball copies (the sandbox
  blocks unpkg) — prototype code untouched.
- Logged deltas (all carried in the PR plan): canon Drafts tab omitted (no
  draft state in the rule model — Q-logged); the canon's intent-flavoured
  reply triggers and 14-field condition matrix fold into `reply_classified`
  intents + the ONE keyword condition; canon "Notify team" folds to
  `notify_team` (run row + Logs = the Phase-1 transport) while the Slack /
  email-alert TRANSPORTS render honest-absent (Q-ledgered); the invalid-row
  Error state is a designed addition with no prototype anchor (flagged W1).
- Run-history rows with real fires land with W3's staging live-proof — the
  drawer here shows the honest none-state ("No runs yet — fires when its
  trigger next happens").

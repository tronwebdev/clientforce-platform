# SC-W2 — "Add a sub-campaign" creator UI (PR #94) · §8 evidence (24 shots, 1440×900)

Canon: `Create Agent.dc.html` — the Branches & rules view (sub-campaign grid +
"Add a sub-campaign" card + ✦ Suggest more branches), the **New sub-campaign**
3-step creator modal (trigger → build method → review → done) and the
sub-campaign drawer — with `Campaign View.dc.html` Steps tab's Branches view as
the dashboard-host grid anchor. One shared `SubcampaignCreator` /
`SubcampaignSection` serves BOTH hosts (wizard step 2 · agent-view Steps tab);
host deltas ride props only (the StepEditorDrawer rule) — the frames below
prove the pair, never two forks.

## Frames

| Frame | What it proves |
| ----- | -------------- |
| `proto-campaignview-subcampaigns` ↔ `build-steps-subcampaign-grid` | The dashboard host: Campaign View's canon grid gone LIVE on the Steps tab — divider ("↳ 1 sub-campaign based on contact behaviour"), container card (trigger chip **💬 Reply: Interested** read from the REAL R1 rule row via `GET planner/subcampaign-rules`, title = `SubcampaignNode.ref`, dark step pills, "2 steps · 3 days", green **Edit ›**), the dashed **Add a sub-campaign** card (replacing W3-4's honest-absence card — R1's vocabulary shipped), and the **DEC-076 live-graph banner** (agent is ACTIVE). The container + rule are REAL rows: created through `POST /planner/subcampaign` (MANUAL v2) before capture. Composition stays the G3 single-list Steps tab (no Sequence/Branches sub-tabs — the standing W3-4 deviation; the sub-tab view arrives with R1's rules UI). No ✦ AI chip on the dashboard — provenance isn't persisted (Q-023), never guessed. |
| `proto-subnew-step0` ↔ `build-subnew-step0-empty` | Creator step 1 of 3, trigger unselected — "Select a trigger…" placeholder, ⎇ header, 3-segment progress, Cancel + disabled Continue, all canon literals. Build deltas: the Name field is a REAL input (canon shows a static div), and the dashboard host renders the **DEC-076 notice** inside the modal (launched agent — designed addition, StepEditorDrawer notice anatomy). |
| `(same frame)` → `build-subnew-live-notice` | The DEC-076 sentence legible inside the creator ("Changes apply to new contacts and upcoming steps — contacts mid-sequence finish on the current version") — the launched-host prop in isolation. |
| `proto-subnew-step0-dropdown` ↔ `build-subnew-step0-dropdown` + `build-subnew-step0-dropdown-end` | The trigger dropdown. Canon lists 9 free-text labels; the build renders R1's SEVEN `campaignRuleTriggerSchema` kinds through the `lib/triggers` display map — never a parallel union. Canon's "Reply received" / "Reply contains keyword" are NOT R1-expressible as creator triggers (recorded as **Q-022**, not built); "Negative reply / unsubscribe" → "Unsubscribed / opted out", "Form submitted" → "Form / lead captured". Two frames because the menu keeps the canon 230px max-height window (7 entries scroll): the `-end` frame shows the DISABLED **Form / lead captured** honest-absence row with its reason "Arrives with lead capture sources" (no click handler — never a dead pick). All email-backed kinds are ENABLED because the workspace's CF_MANAGED sender is live (the honest-absence input is a real senders scan). |
| `build-subnew-step0-filled` | `reply_classified` picked → the M1b intent chips render (labels/tints VERBATIM from `intentTint` — one intent vocabulary; "Interested" selected) + name "Interested follow-up". Designed parameterization: canon's creator step 0 has no intent picker (the canon RULE modal's intent-chip anatomy is the anchor); `sequence_quiet` gets the same treatment with a days input. |
| `proto-subnew-step1` ↔ `build-subnew-step1-ai` | Build-method step — "✦ Let AI draft it" selected: 2px `#35E834` border, `rgba(53,232,52,.05)` fill, **Recommended** chip, "✎ Build from scratch" beneath. Canon literals verbatim. |
| `proto-subnew-step2` ↔ `build-subnew-step2-review` | Review & create — Name / Trigger / Built-with rows on the `#FBF7F0` card. **This sandbox has no Anthropic key**, so the AI path's compose-preview answered its designed 503 and the creator fell back HONESTLY: the frame carries the `✎ AI draft unavailable — starting from scratch` note and "Built with" flips to **Build from scratch** — nothing faked as AI. The ✦-marked drafted rows are deferred (below). |
| `proto-subnew-done` ↔ `build-subnew-done` | Done state after creating the SECOND branch — "Re-engagement sequence", `{kind:"sequence_quiet", days:30}`, scratch path, landed as REAL MANUAL v3 through the same gate (the new container card is visible behind the modal). ✓ circle, "Sub-campaign created", recap card (Trigger **⏱ No reply · 30 days** / Built with). The scratch body copy ("It runs automatically when a contact matches the trigger — add steps whenever you're ready.") is DESIGNED — canon only wrote the AI build's sentence. |
| `proto-sub-drawer` + `proto-sub-drawer-footer` ↔ `build-subchain-expanded` | Canon opens a 520px right drawer per card; the build expands the chain INLINE under the grid (designed composition — the Steps tab already hosts the sequence-card anatomy): **Edit ›** toggles the "INTERESTED FOLLOW-UP · STEPS" group — chain step cards (Step 1 "Booking?", the ⏱ Wait 3 days pill, Step 2 "Threaded reply" · Email · threaded chip), each with ✎ Edit, and the indented dashed **+ Add step** (the canon drawer's add anatomy). The footer frame anchors the canon red-action row ("Delete sub-campaign") the shared drawer's red **Delete step** descends from (DEC-076 lineage). |
| `build-subchain-drawer` | The SHARED `StepEditorDrawer` open on a sub-chain step — subject/body, deterministic deliverability rows, personalization tokens, DEC-076 notice, red **Delete step**, **Save step**. Per W2: sub-campaign chain steps carry NO mode-control strip (the flip's brief seed is main-sequence-arc-derived). Same component as the wizard and main-path cards — one drawer, three surfaces. |
| `build-steps-refusal` | The loud 422: a THIRD branch attempted on the duplicate trigger `reply_classified ["interested"]` → the gate's detail renders VERBATIM in the modal error row — "A sub-campaign already enters on this trigger — edit that branch or pick a different trigger" — and nothing persisted (no stuck busy state; #88 precedent). |
| `proto-branches-view` ↔ `build-wizard-branches-grid` | The wizard host's Branches & rules view: Campaign flow dark card (real graph pills + "Contacts enroll at launch · Draft" — the real audience line, vs canon's "All 240 contacts enrolled · Active"), reply-branch card, the sub-campaign divider + grid + add card via the SHARED section, and **✦ Suggest more branches**. The two cards show BOTH chip states honestly: "Re-engagement sequence" carries its trigger chip (in-session created — provenance known), while "Interested — book a call" (created in a PRIOR session, i.e. a resumed draft) renders **Rule pending** — honest absence, never a guessed trigger. Canon's "Automation rules" rows are R1's rules UI, not W2 — not built here (the W2 API surface is a display READ only). |
| `build-wizard-suggest-popover` | The suggestions panel — DESIGNED ADDITION behind the canon affordance (canon wires the link to a regenerate stub): deterministic goal-seeded rows ("Interested — book a call" · 💬 Reply: Interested / "Re-engagement sequence" · ⏱ No reply · 30 days) with the honest label "Deterministic suggestions from your goal — AI drafts the steps if you want." Accepting opens the SHARED creator prefilled at the build step — review + the same POST gate still run. |
| `proto-subnew-step0` ↔ `build-wizard-subnew` | The prop-diff proof: the SAME creator modal inside the wizard host — identical anatomy, **no DEC-076 notice** (draft agent). One component, two hosts, deltas ride props. |

## Capture environment & disclosures

- **Real local stack:** Postgres 16 + pgvector (RLS role `clientforce_app`),
  Redis, worker heartbeating, api :3001 (`node dist/main.js`), web :3000
  (production build via `next start`), dev sign-in, seeded demo workspace.
  Every creation ran through the REAL `POST /planner/subcampaign` three-layer
  gate (each landed as the next MANUAL version + its R1 `CampaignRule` row);
  chips read back through the real `GET /planner/subcampaign-rules`.
- **Seeded fixtures (disclosed):** both agents' v1 graphs are the
  `subcampaigns.e2e.spec.ts` `GRAPH_V1` fixture (planner-SHAPED, the M1b
  precedent) inserted as source AI; agent A is ACTIVE (the live-banner host),
  agent B is a DRAFT resumed into the wizard via B6
  (`/agents/new?agent=<id>`, `draftState {step:1}`).
- **No Anthropic key exists in this sandbox** — `planner/compose-preview`
  answers its designed 503 and every AI affordance falls back through its
  HONEST path (the fallback note frame above). No composer output was faked.
- The wizard frames carry the environment banner disclosing exactly that
  ("AI planning isn't configured yet — … ANTHROPIC_API_KEY") — honest
  environment state, not canon anatomy.
- Prototypes loaded from the repo files; their unpkg React/Babel deps
  fulfilled from npm-registry tarball copies via Playwright route interception
  (C2.2 vendoring precedent); Google Fonts fetched live through the session
  proxy. Prototype files untouched.
- Capture seed + Playwright scripts were dev-local and never committed.

## Deviations & deferrals (for the PROGRESS.md fidelity log)

- **DEFERRED to W3's staging window (real composer):** the ✦-marked AI-drafted
  review rows (`subnew-draft-row` + "✦ AI-drafted" chips), the AI done-copy
  ("AI drafted a N-step sequence for this branch…"), and the wizard card's
  ✦ AI chip (needs an in-session AI-built branch). All exist in code behind
  the same honest-AI rail; this sandbox has no key, and faking composer output
  is off the table.
- Canon's **"Reply received" / "Reply contains keyword"** triggers are not
  R1-expressible as creator triggers — omitted per the display-map rule and
  recorded as **Q-022** (visible in the proto dropdown frame for the diff).
- The dashboard **✦ AI provenance chip** is deliberately absent (unpersisted —
  **Q-023**); the wizard renders it only for in-session provenance (none in
  these frames — both wizard branches were scratch-built).
- **Inline chain expansion** replaces canon's per-card drawer on the Steps tab
  (designed composition; the SHARED StepEditorDrawer still edits every chain
  step). The canon drawer anatomy is anchored by `proto-sub-drawer(-footer)`.
- The creator adds **real parameter editors** (intent chips / quiet-days
  input) and a real Name input where canon shows statics — the R1 trigger
  union demands parameters; intent labels come from the one vocabulary.
- **Framing notes:** the grid frame starts at the DEC-076 banner (banner →
  add-card spans 851px; the "Main sequence" header row above it would push
  past 900). The trigger menu keeps canon's 230px max-height, so its 7 entries
  need the two dropdown frames. The proto drawer's footer sits below the fold
  at 1440×900 (the prototype overlay spans document height) — captured
  separately as `proto-sub-drawer-footer`.
- **Observation (not fixed here):** the wizard resume page
  (`/agents/new?agent=<id>`) logs a React hydration mismatch (minified #418)
  on load — pre-existing, renders fine; worth a follow-up.

# PROMPT — V3 W0+W1 KICKOFF (tokens + shell behind flag)

You are continuing the clientforce-platform build. Read `PROGRESS.md` (Status table + last 30 ledger entries) and `design_handoff_console_v3/README.md` BEFORE any code. This unit ports the Console v3 SHELL only — no surface content. Protocol: PHASE1_HANDOFF §E; conflicts → DEC/Q entries in PROGRESS.md, never silent choices.

## Non-negotiable contract (MIGRATION_NON_BREAKING.md)
- Everything lands behind feature flag `consoleV3` (per-workspace, default OFF) on parallel routes `/v3/*`. Zero edits to legacy screens or their routes.
- Additive-only: no renames/drops/behavior changes to shipped endpoints, components, or tokens. New token variants sit BESIDE legacy in packages/ui.
- Legacy e2e smoke stays green — run it in CI for this PR.
- Atoms come from `design_handoff_console_v3/DESIGN_TOKENS_V3.md` (it wins on color/type/spacing/radius). Composition/behavior/copy come from `design_handoff_console_v3/prototypes/Clientforce Console.dc.html` (it wins — open it, click everything; UI_PORTING_RULES.md applies verbatim).

## W0 — packages/ui: v3 token variants (additive)
1. Add a `v3` token set (CSS vars or theme object, matching how packages/ui exposes tokens today — inspect first, follow the existing mechanism):
   surfaces: wash #EFF1F0 · panel #FCFCFC · card #FFFFFF · hover #F6F7F7 · well #F2F3F3
   hairlines: #ECEDEC / #F0F1F0 / #EAEBEA / #E2E4E3 · ambient shadow 0 1px 2px rgba(16,22,19,.045)
   ink #101613 · muted #5A6660 · faint #8B968F
   roles: forest #146B33 (+mint #EAF5EE/#CFE8D8) = Ada/live/create ONLY · cyan #0E7D93 (+#E2F3F6/#BFE3EB) = navigate · amber #8A6D1A (+#F7EFDA/#EAD9A8) = needs-you · danger #B0483A/#FBEEEA · slate #356170 (+#EAF3F5/#CFE4E9) = system
   radius: control 10–14 · card 16–18 · sheet 20 · pill 999
   type: Schibsted Grotesk 800/900 display (page title 900 28px -.04em, gradient ink linear-gradient(180deg,#101613 25%,#14743A 120%) background-clip:text) · IBM Plex Sans body · IBM Plex Mono data labels
   signature gradient linear-gradient(135deg,#36D7ED,#35E834 55%,#D0F56B) — exposed as ONE token, usage rule in comment: logo + ≤2 moments/screen, never fills/buttons.
2. Do NOT restyle any existing component. New primitives only if the shell needs them (Tile, HairlineCard, MonoLabel) — added, not replacing.

## W1 — apps/web: /v3 shell behind `consoleV3`
Build the shell exactly as the prototype's resting + interaction states:
1. **Layout**: wash page → left floating campaign RAIL (262px) → center canvas column (max 1120px, centered) → right DOCK strip. All chrome per proto.
2. **Rail**: logo row (assets logo-dark) + focus capsule (27px tile, logo-gradient wash + white shine, double-chevron mark 2nd @40%, soft green glow, hover deepens — collapses rail, MANUAL ONLY, no auto-collapse anywhere); workspace switcher popover (WORKSPACES list + ⚙ Workspace settings + Account home rows); Campaigns panel: header + count pill, campaign rows (name · ✦ suggested tag · ✓ GOAL MET mono pill · status dot · goal sub-line; selected = mint bg + right-edge connector arrow), cyan "View all campaigns ›", SUGGESTED ✦ section (dismissable), collapsed rail = compact pill + icon (not full height). **Credits strip** pinned to the rail business card on EVERY page (Addendum 2 §A): live balance + Top up — chip visible to all roles, Top up button Owner/Admin only, balance is app-wide state so a top-up updates it everywhere. Data: shipped campaigns list endpoint; goalMet exposed as additive field (Q-entry if absent — do not block shell on it, stub the pill behind the field's presence).
3. **Focus choreography** — LOCKED SHARP (owner, supersedes the earlier slow-premium recipe): rail fade .22s / slide-out crisp · canvas scale .34s · dock unfold .38s · ALL on cubic-bezier(.32,.72,0,1). Manual only. The slow 2.8–3.8s variant is RETIRED — it survives in CONSOLE_V3_BUILD_NOTES ("Focus choreography variants") purely as a one-edit flip-back; do not build it. Record before/after video for the PR.
4. **Dock**: Console tile (✦ + gradient underline, breathing, dot when stack collapsed) + 9 menu tiles, Style A: tile = white-shine-over-signature-gradient blend (active: full gradient + ink ring), FILLED logo-glyph marks (copy the 9 evenodd paths verbatim from the proto's dockDefs), tooltips, Inbox badge = needs count (amber ping). Receptionist tile sits ABOVE the menu container, separated (grayscale until add-on active — static placeholder this wave). Dock stack expand/collapse per proto timing.
4b. **Page-container chat tail** (dock pages only): the canvas grows a 19px chat-bubble tail on its right edge pointing at the ACTIVE dock tile — tile rect measured at runtime, resize-aware, slides .3s between menus.
5. **Ada bar** (chrome only this wave): bottom bar with glow border, per-surface placeholder + chips read from a static config map keyed by route (copy strings from proto's PH/M maps); typing routes nowhere yet — input + chips render, submit no-ops with a receipt toast "wired in W2+". ? help fab at the bar's right end + floating ? on barless pages; help panel shell opens with per-surface copy from proto's help map.
6. **Empty canvas**: W1 renders the Overview surface as a placeholder card ("W2 lands here") — no surface content in this wave.

## Acceptance (attach to PR)
- Screenshot pairs proto-vs-port: rail resting · rail collapsed · focus mode mid-transition · dock expanded/collapsed · Ada bar + help panel · workspace popover. Motion: short capture of focus choreography.
- `consoleV3` OFF → app byte-identical behavior on legacy routes; ON → /v3 shell loads with live campaign list.
- Legacy e2e green. PROGRESS.md entry with DEC/Q log + this unit marked.

## Placement note (owner)
Commit `design_handoff_console_v3/` at repo root first, then send this prompt to Claude Code as the W0+W1 dispatch.

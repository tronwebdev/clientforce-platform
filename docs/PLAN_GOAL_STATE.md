# PLAN — Dynamic goal-completion state ("C2.8", owner-recalled agreement logged 2026-07-07)

> **The agreement (owner, re-stated 2026-07-07):** "Meeting booked" is hard-coded
> as the terminal stage everywhere because booking used to be the only goal.
> With 9 goals, the terminal state's WORDING must be dynamic per goal —
> promote_offer completes as a purchase/claim, reactivate_leads as a
> reactivation, etc. Surfaces named: Campaign view → Inbox intent chips, and
> Contacts → segment tabs / status sorting-filters.
> Status: **APPROVED (owner, 2026-07-07)** — all four OPEN items yes as
> proposed. Sequencing: DEFERRED — not necessarily C2.8; slots after the
> wizard bug-fix round + C2.7, exact position owner-decided at the time.
> Becomes a DEC + checkpoint amendment at its kickoff.

## Per-goal terminal labels (proposed — owner approves/edits)
| Goal key | Chip/timeline label | Short pill (tables/tabs) |
|---|---|---|
| book_appointments | Meeting booked | Booked |
| generate_leads | Lead qualified | Qualified |
| reactivate_leads | Reactivated | Reactivated |
| drive_signups | Signed up | Signed up |
| collect_reviews | Review left | Reviewed |
| promote_offer | Purchase made | Purchased |
| fill_event | Registered | Registered |
| upsell_clients | Upsell accepted | Upgraded |
| custom | owner-typed in wizard (default "Goal met") | Goal met |

Labels live in code beside the goal registry (`packages/core` GOAL_META:
`{ terminalLabel, terminalPill }`) — same pattern as CONTEXT_FIELD_META, no
migration. `custom` gets an optional typed label captured in wizard step 1.

## Where the dynamic wording renders
1. **Campaign view → Inbox intent chips**: the goal-completion category chip
   uses the campaign's goal label (a promote_offer agent shows "Purchase
   made", never "Meeting booked"). Counts unchanged.
2. **Contacts**: segment tab + status pill + status-filter dropdown + quick
   toggle ("Booked only") + bulk "Move to" menu + drawer timeline stage rows.
3. **Campaign view → Leads tab**: stage pills + stage filter.
4. **Wizard step 1**: the completion-signal explainer under the goal picker
   names the goal's own terminal label.
5. **Agents list**: goal-met count column keeps its metric header generic.

## The aggregation rule (Contacts is cross-agent)
Per-ROW pills always show the specific label from the campaign that completed
that contact (stored on the stage-change event). For workspace-level LABELS
(segment tab, filter option, quick toggle):
- If every active agent shares one goal → that goal's short pill verbatim.
- Mixed goals → generic **"Goal met"**.

## Runtime (the actual dynamic state, not just wording)
- Internal stage key stays ONE value (today's `BOOKED`) — **display-layer
  mapping only, no enum migration**; rename internally to `GOAL_MET` only if
  cheap. A10 derived-status logic unchanged.
- Completion detection per goal: book_appointments keeps today's
  booked-event path. Other goals flip on the classifier matching the goal's
  completion signal (the v2 wizard copy's promise) → stage-change event
  carries `{ goalKey, label }` → drawer timeline renders it verbatim.
- Until a goal's detector ships, its agents simply never reach the state
  (honest absence; no fake data).

## Design pass — see WAIVED section below (label table is the fidelity source)

## RESOLVED (owner, 2026-07-07 — “yes to all 4”)
1. Label table approved as written.
2. Mixed-goal fallback: **“Goal met”**.
3. Runtime scope this unit: **labels + book_appointments detector only**;
   per-goal detectors ship later (honest absence until then).
4. Sequencing: owner slots it as C2.9 (after C2.8 lists + the import round).

## Design pass — WAIVED (owner delegate, 2026-07-08)
No new anatomy exists in this unit — every surface (chips, tabs, pills,
filter options, timeline rows) already has its prototype form; only the TEXT
becomes goal-dynamic. The label table above is the binding fidelity source;
§8 evidence validates rendered labels against it. Log this waiver as part of
the adoption DEC.

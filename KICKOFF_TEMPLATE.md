# Kickoff template — standing conventions every unit prompt inherits

> Not a unit itself — the boilerplate every `PROMPT_*_KICKOFF.md` restates or references.
> Keeps units self-contained while the shared rails stay in one place.

## Header block (every kickoff opens with)
- STATUS (DRAFT / READY TO DISPATCH / DISPATCHED / MERGED) + date.
- DEC claim rule: claim next-free DEC ids at dispatch against LIVE main; verify
  collision-free; renumber-on-collision applies; never renumber a merged DEC.
- Slot check: two-track cap; name the units holding tracks; parked PRs are not tracks.
- PR-watch armed at dispatch; re-arm manually if the permission stream drops (#88 lesson).

## Standing rails (assert in tests, not just review)
- One graph, one authority; every mutation through validation + auto-repair.
- **No planner prompt changes** (hard no) — stop-and-ask if a wave thinks it needs one.
- No send path around the boundary; new channels PORT the rail order + refusal enum,
  never fork it; compliance literals render exactly once.
- Graph versioning (DEC-076): in-flight enrollments finish on their enrolled version.
- Honest absence + F1 statistical-honesty floors (none <20 · low 20–49 · ok ≥50);
  no invented metric, no canned AI presented as live; ✦ marks AI-composed with provenance.
- D0: no new agent-creation wizard fields — derive at creation, edit in Settings.
- Additive-only schema; events versioned; PROGRESS.md append-only, rebase before merge.
- One PR per wave; plan comment first (files / migration / tests / claimed DEC ids);
  §8 evidence pairs (prototype ↔ build) on a real local stack; merge-on-green after review.

## ⭑ Backoffice-coverage ride-along (STANDING — every unit)
If this unit introduces a **new billable action, a new event type, a new kill-worthy
send path, or a new manageable tenant entity**, it WIRES INTO THE MATCHING BACKOFFICE
SPINE IN THE SAME PR — never a later retrofit. The five spines and today's coverage are
in `CHECKLIST_B1_BACKOFFICE_COVERAGE.md`. If a management need can't be expressed through
a spine, EXTEND THE SPINE (don't add a feature-specific backoffice panel) and file a Q
against that checklist. State the coverage delta in the plan comment.

## ⭑ Automation-vocabulary ride-along (STANDING — every feature unit)
If this unit ships a feature with automation-worthy moments — anything a user
would plausibly say "when X happens, do Y" about (form submitted, payment
received, proposal accepted/viewed, widget chat started, call outcome, lead
enriched…) — it REGISTERS the typed triggers/conditions/actions in the R1
engine vocabulary IN THE SAME PR, and they light up in the Automations picker
automatically (the picker enumerates the vocabulary — zero UI change). The
honest-absence Q entries from R1-UI's picker↔vocabulary diff — **Q-030..Q-045**
in PROGRESS's Open questions — are the STANDING ledger every feature unit's
plan comment reconciles against (owner directive, 2026-07-21): name which of
those Q entries the unit closes, and propose the trigger/action list for owner
sign-off so nothing important is left out.
Never ship a feature whose events exist but whose automation hooks silently
don't.

## Close-out (every unit ends with)
- PROGRESS.md status row + DEC entry (decisions + deferred list) + fidelity-log row.
- Ride-along board flips for lagging status rows on the first PROGRESS touch.
- Deferred/edge items recorded as Q-#### rather than built out of scope.

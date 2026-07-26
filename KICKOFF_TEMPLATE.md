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
- **ZERO check runs is UNGATED, not "pending" — a HARD BLOCKER** (INT/DEC-096
  amendment 3, owner directive 2026-07-26). `ci.yml` fires on `pull_request`, and
  GitHub can only run it against a TEST-MERGE of head into base — which it cannot
  build while the PR is conflicted. So a conflicted PR gets NO check suite at all,
  and the combined status reads `pending` with `total_count: 0`. That is the failure
  mode where **the symptom masks the diagnostic**: the conflict suppresses the very
  gate that would have caught it. Never read an empty check list as "CI hasn't
  reported yet" — resolve the conflict, then require a real green. And do NOT read
  "it only affects conflicted PRs" as low-risk: it is not a gap that degrades gently
  across healthy PRs, it **fails hard on precisely the PR that most needs the gate** —
  the one whose history diverged far enough to conflict. A LOCAL
  `pnpm build/lint/test` and a `workflow_dispatch` live-proof are real evidence of
  different things, but NEITHER is a merge gate: dispatch runs never attach to a PR
  as a check however they end.
- **NEVER assert a counted vocabulary against a LITERAL — derive it from the union**
  (the 11-vs-12 class, DEC-096 amendment 3). Where two tracks both extend a counted
  set (trigger/action options, picker lengths, dimmed/clickable tallies), each side's
  `toHaveLength(n)` is correct only for ITS OWN lineage. Two branches can assert the
  SAME WRONG number for DIFFERENT reasons; three-way merge sees identical text, keeps
  it, and merges clean. Git is structurally blind to this, and a rule that says
  "recompute by hand during a conflict resolution" is exactly the rule that fails
  during a conflict resolution — the merge that most needs the arithmetic is the one
  where attention is thinnest. So make the bug UNREPRESENTABLE, not documented:
  `toHaveLength(SCHEMA_KINDS.length)`, never `toHaveLength(12)`; render-affordance
  tallies derive from the vocabulary filtered through the real gate (the `menuCounts`
  helper in `subcampaign-creator.test.tsx`). A new kind then moves every count BY
  CONSTRUCTION. Keep the semantic pins literal on purpose — canon labels and
  availability classification SHOULD fail until a human decides them; it is only the
  arithmetic that gets derived. Where a Set-equality pin already exists, the derived
  length still earns its place: a Set collapses duplicates, so only length catches a
  kind listed twice.
- **A check that can pass on a SUBSTRING is not a check — verify STRUCTURE, not text**
  (INT/DEC-102, owner directive 2026-07-26). Three failures in one session shared
  this exact shape, so treat it as a pattern rather than three accidents:
  `grep 'error TS'` on a turbo run reported clean while the run had FAILED (the
  exit code knew); the `lint:ledger` id patterns required exactly one space and so
  went blind to Prettier-padded rows, missing the very DEC collision they exist to
  catch; and `grep -c 'P7 close-out'` returned a hit because the PHRASE appeared
  inside two status rows while the SECTION HEADING had been dropped by a merge.
  Every one PASSED while the thing it checked was absent — the failure direction is
  always FALSE CONFIDENCE, which is the direction you cannot feel. So: prefer the
  EXIT CODE over parsing output; assert the parsed node or the anchored heading
  (`^## P7 close-out`) rather than "the words appear somewhere"; and prefer a
  DERIVED COUNT over a string match wherever one exists. If a check would still
  pass with the artifact deleted and only its name mentioned elsewhere, it is not
  verifying anything.
- **Exact-match gating on `workflow_dispatch` inputs — never negated matches.**
  `if: inputs.walk == 'slack'`, never `!= 'other-walk'`: a negated gate silently
  ADOPTS every future input value, so adding a third walk fires the first walk's job
  against a real vendor (this nearly posted a HubSpot dispatch to the owner's Slack).

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

## Local-environment gotchas (cost a unit time; not bugs)

- **A red build right after pulling `main` is usually STALE DIST, not a broken merge.**
  When another track lands a new workspace package (or new exports on an existing one),
  your `node_modules` links still point at the old `dist` — TypeScript reports it as
  `has no exported member`, in files you never touched, which reads exactly like someone
  merged something broken. Run `pnpm install` then build the changed package (or
  `pnpm build`) before diagnosing anything. WID2 lost time to this twice in one session
  (`@clientforce/recall`, then `@clientforce/integrations`).
- **Postgres is not running by default.** DB-backed suites `describe.skipIf` themselves
  into silence, so "all green" can mean "never ran". If your unit touches schema or RLS,
  start one and prove the migration + policy for real — a migration nobody executed is a
  claim, not a verification.

## Close-out (every unit ends with)

- PROGRESS.md status row + DEC entry (decisions + deferred list) + fidelity-log row.
- Ride-along board flips for lagging status rows on the first PROGRESS touch.
- Deferred/edge items recorded as Q-#### rather than built out of scope.

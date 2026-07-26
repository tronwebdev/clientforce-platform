# SPEC A (DEC-099) — §8 evidence: on-call contact awareness

## What this unit adds to a UI surface

One block: **"Looked up on this call"** on the Calls tab detail pane, below the
transcript. Everything else in the unit is engine, schema and prompt.

## §0 — designed addition, no prototype exists (flagged)

The Campaign View canon predates mid-call retrieval entirely; there is no
prototype treatment for a retrieval-receipt surface anywhere in
`design_handoff_clientforce_restyle/`. A prototype↔build pair is therefore
**not possible** for this block, and none is claimed — the §8 rule for an
internal surface with no canon (`PHASE1_FIDELITY_CHECKPOINTS.md §8`).

Anatomy is borrowed rather than invented, so it reads as part of the pane:

| Element                                                    | Borrowed from                                     |
| ---------------------------------------------------------- | ------------------------------------------------- |
| Section header (11px / 700 / uppercase / .06em, `#8A7F6B`) | the Transcript header in the same pane            |
| Left gutter label (11.5px / 700, 54px wide)                | the transcript turn's Agent/Lead speaker column   |
| Body line (13.5px / 1.5, `#3B463F`)                        | the transcript turn body                          |
| State pill (11px / 700, radius 7)                          | the call outcome pill's palette (`OUTCOME_STYLE`) |

## The shot

`build-call-retrievals.png` — 1440×900 viewport, 2× device scale, the detail
pane at its real 760px content width.

**Honest scope of this evidence:** it is a **component-level** render — the
shipped `CallRetrievalsBlock` exported from `CallsTab.tsx`, rendered through
`renderToStaticMarkup` with the transcript turns above it as static context.
It is NOT a full-stack shot (web build + api + PG + a real dialed call), and
it must not be read as one. The rows in frame are fixture data chosen to put
all three receipt states in one frame.

The full-stack pair — a real dialed call whose receipts land through the live
API — belongs to the staging live proof, which is owner-gated on a dial (the
DEC-090 posture: no calls until deployed).

**Owner ruling (2026-07-26):** this owed shot rides the SAME gate as voice
Q-048's loopback probe. When the second Twilio number is handed over, both run
in ONE session rather than two separate dial-outs. Recorded as owed, not
claimed.

## What the shot is meant to show

The three receipt states are deliberately distinct, because they are three
different claims about the same silence:

- **`N found`** — the record answered, and the agent's turn was grounded in it.
- **`Nothing on record`** — the agent looked and the record was silent. In the
  frame this pairs with the agent's turn _"I don't have a booking in front of
  me"_ — the receipt is what makes that honesty checkable after the fact.
- **`Couldn't check`** — the lookup never completed (timeout, store failure).
  Distinct from the above on purpose: only one of them is a knowledge gap
  worth chasing; the other is an infrastructure problem.

Empty and refused lookups are rendered, never filtered for tidiness. A turn
with **no** receipt was answered from the brief alone, and that absence is
itself the audit signal.

## Verified

- `apps/web/test/call-retrievals.test.tsx` — the three states, the shared
  facet-label vocabulary, verbatim query rendering, and the render-nothing
  case (a call that never read the record shows no block at all, rather than
  an empty one that would read as the feature failing).
- `apps/api/test/voice.e2e.spec.ts` — receipts ride `GET /calls/:id` in call
  order, with empty and refused rows surviving to the surface distinguishably.

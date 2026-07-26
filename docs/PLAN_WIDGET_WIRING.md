# PLAN · Widget wiring unit (WID2) — the seam's server half

**STATUS: READY TO DISPATCH — 2026-07-26.** Dispatched off Q-050 by owner
instruction; inherits `KICKOFF_TEMPLATE.md` in full.

**DEC claim, re-verified against live `main` `ae235d4`:** `DEC-101` (free — live
max is DEC-100). New Q ids claimed: **Q-057** (widget voice transport) ·
**Q-058** (calendar-provider dependency); live max is Q-056.

_Claim history, because it is instructive:_ the dispatch first claimed
Q-053/054. Then **#108 merged** and took both for its W2/W3 splits — it had
renumbered its own 047–050 claims up to 053–056 for exactly the same reason — so
these move again. Renumber-on-collision working as intended: an unstarted unit's
ids are the most movable thing in the system, and a merged row never moves. Note
the `pnpm lint:ledger` guard could **not** have caught this — it checks ROW
identity, and a claim that lives in prose is not a row. Re-verify at PR time,
not once at dispatch.

**Slot check (two-track cap):** #108 INT holds one track (W2–W4 outstanding). The
WID track freed its slot when #113 merged, so this unit takes it. No parked PR is
counted as a track.

**PR-watch armed at dispatch.**

---

## 1 · Why this unit, and what it is not

Unit 27 shipped the widget's client half: shadow-DOM embed, console-v3 shell
measured against the panel canon, the config surface, the six flow toggles, and
**one documented endpoint behind an honest stub**. Every remaining widget item is
downstream of the server half, and the product value — a visitor who actually
books, actually gets called back, actually receives an estimate — lives entirely
in flows that do not exist yet.

This unit builds that server half. It is **not** a redesign: the panel's
placement, tokens and geometry are settled (DEC-097/098/100) and stay untouched
except where a flow adds a NEW surface, and those surfaces have canon already
(outcome card = semantic mint/forest; voice overlay = the measured anchor).

## 2 · Scope

**A · Contract promotion (the repo convention).** `src/api/contract.ts`'s shapes
become **zod DTOs in `@clientforce/core`**, and the widget imports them rather
than declaring its own. `contractVersion: 1` is preserved; the client's shapes
are already the contract of record, so this is a move plus validation, not a
redesign. `HttpTransport` becomes the default once `apiBase` resolves.

**B · The NestJS `widget` module.** `POST /widget/v1/session` as specified: a
public, unauthenticated-but-keyed rail where the page carries only the `wgt_…`
public id and the server resolves it to workspace/agent/campaign, so **no tenant
identifier ever reaches the host page**. Every feature query goes through
`withTenant` after that resolution (never the owner client, never the backoffice
role — DEC-079). Rate limiting and origin allow-listing per widget id belong
here, not in the client.

**C · `branding.platformAttribution` becomes a real plan check.** The client half
is done and structurally sealed (no attribute, no init option). The server
resolves the owning agency's tier and returns `false` only for tiers that include
white-label. Default-on everywhere; never a workspace-user toggle (canon §7).

**D · The six flows, each end-to-end or honestly absent.** Book a visit ·
Call me back · Schedule callback · Get an estimate · Live voice · Ask a question.
The panel already renders only the enabled subset, so each flow is a server
capability plus the surface it needs:

| Flow              | Server half it needs                                           | New surface                               |
| ----------------- | -------------------------------------------------------------- | ----------------------------------------- |
| Book a visit      | real slot availability → hold → confirm                        | slot picker + outcome card                |
| Call me back      | live dial via the voice rail; dialing/ringing/live/done states | call-state strip + transcript quote       |
| Schedule callback | a scheduled callback + SMS-reminder consent                    | time picker + consent line + outcome card |
| Get an estimate   | goal → email capture → generation → delivery                   | generating state + sent card              |
| Live voice        | the widget voice transport (Q-057)                             | the voice overlay (anchor is committed)   |
| Ask a question    | grounded FAQ retrieval + the nudge                             | none (thread only)                        |

**The outcome card is the terminal surface of five of the six**, and per the
owner's brand-vs-semantic ruling it keeps **canon mint/forest** on every panel,
white-label or not — it is green because it means good. It is the one surface
this unit MUST build; it is deliberately absent today (a test asserts no
`cfw-outcome` exists) precisely so it lands with real data behind it.

**E · Ride-alongs (standing, same PR).**

- ⭑ **Automation vocabulary.** `widget_chat_started` is the long-open one
  (Q-035); this unit also has real producers for chat-completed, booking,
  callback-requested, estimate-sent and call-outcome moments. The plan comment
  proposes the trigger/condition/action list for owner sign-off and names which
  of Q-030..Q-045 close. Nothing is registered without a real producer.
- ⭑ **Backoffice coverage.** A widget session is a new **billable action** (AI
  turns, generated estimates, outbound calls) and a new **kill-worthy send
  path** (an embedded agent talking to the public). It wires into the matching
  spines in `CHECKLIST_B1_BACKOFFICE_COVERAGE.md` — **extend a spine, never add
  a widget-specific panel** — and the plan comment states the coverage delta.
- **Event catalog.** `widget.*` entries in `packages/events`, versioned
  (`widget.chat.started.v1` …), registered only where a producer fires.

## 3 · Rails this unit must not cross

- **No planner-prompt changes** (hard no) — if a flow seems to need one, stop and ask.
- **No send path around the boundary.** Callback SMS and estimate email PORT the
  existing rail order and refusal enum; compliance literals render exactly once.
- **Additive-only schema**; events versioned; `PROGRESS.md` append-only.
- **Honest absence.** A flow whose provider is missing renders nothing — no
  placeholder slot picker, no fake dialing animation, no "Booked · Tue 10:30"
  without a booking. Where a dependency is absent, the flow toggle stays off and
  a Q row records why.
- **No new agent-creation wizard fields** (D0) — derive at creation, edit in Settings.
- **The client's visual layer is settled**: `--cfw-brand` is the only color knob,
  brand green derives from it, semantic green does not, and the attribution line
  has no client switch. New surfaces inherit those rules rather than restating them.

## 4 · Dependencies, named honestly

- **Calendar/booking** — #108's W2 wave (Google Calendar test-user mode +
  Calendly) is the natural provider for "Book a visit". Until it merges, that
  flow's server half has no calendar to talk to → **Q-058**. **RULED (owner,
  2026-07-26): gate the flow on the `Integration` spine's probe** — it is
  honestly off until a provider connects, which is the same honest-absence
  pattern used everywhere else. Sequencing behind #108's W2 would couple two
  tracks and make the widget's ship date depend on an unrelated merge.
- **Voice** — the on-call retrieval unit (DEC-099) landed live-call tooling, but
  the WIDGET voice transport (browser mic → agent → audio back) is a distinct
  rail and is **not** assumed to exist → **Q-057**. Live voice stays off until it
  does; the overlay is built only when there is a call to render — its placement
  anchor and measured spec are already in `docs/fidelity/wid/` (DEC-100).
- **Credits/billing** — widget turns are billable; the metering path must exist
  before the flows can bill, which is why the backoffice ride-along is scoped in
  the same PR rather than retrofitted.

## 5 · Tests (assert, don't review)

- Contract: the zod DTOs accept the client's own request fixtures verbatim
  (round-trip against `packages/widget`'s existing shapes) and reject a bad
  `contractVersion`.
- Tenancy: a `wgt_…` id resolves without any tenant id crossing the boundary;
  RLS holds via `withTenant`; a session for workspace A can never read B.
- Attribution: the plan check is the ONLY path to `false` — the existing
  client-side test stays, plus a server test that a non-white-label tier always
  returns `true`.
- Flows: each enabled flow's happy path end-to-end against a real local stack;
  each flow with a missing provider renders nothing (honest absence asserted,
  not just documented).
- Outcome card: canon mint/forest under white-label too (the semantic-green
  carve-out, asserted).
- §8: the fidelity set for every NEW surface, against the mock/anchor where one
  exists; internal-only surfaces say so.

## 6 · Close-out

`PROGRESS.md` status row + the DEC-101 entry (decisions + deferred list) +
fidelity-log row; Q-049 closes if the voice overlay lands, otherwise its voice
item carries forward; Q-050 closes when the six flows are either wired or
recorded as off-with-a-reason; Q-035 closes with the automation registration;
new deferrals as Q rows rather than out-of-scope building.

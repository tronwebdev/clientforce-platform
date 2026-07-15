# P3.1 · Voice production — §8 fidelity set (PR #93) — 17 shots, 1440×900

Canon: `Campaign View.dc.html` (Calls tab 199–277 · phone/voice settings card
699–715). The spoken-name capture surfaces (Senders flow step, Settings spoken
name row) are designed states with no prototype anchor — DEC-065(6) waiver
pattern, composed from the §0 card/label/chip conventions. Deviations all
carry DEC-078(7).

## Frames

| Frame | What it proves |
|---|---|
| `proto-calls-tab` ↔ `build-calls-default` | The Calls tab canon vs live: chips row + ☎ Start AI call, 380px list/detail split, row anatomy (avatar · name · time · ↗ AI outbound · duration · outcome pill), transcript speaker column, footer actions. Build data is REAL (seeded transcript written in the exact service shape; the QUEUED row is a live sandbox dial through the rails). The locked disclosure literal is visible as turn 1. |
| `build-calls-filter-completed` | Outcome chip active state (gradient pill + count) filtering the list. |
| `build-calls-dial-flyout-open` | Start AI call → contact flyout (stateful control OPEN; contacts with phones only). |
| `build-calls-refused-notice` | A dial to a suppressed number refused typed — the notice points at Logs. |
| `build-logs-call-refused` | The `call.refused.v1` Logs rows (⊘, reason SUPPRESSED) — the acceptance's refusal Logs row, produced by the REAL rail walk. |
| `build-calls-empty` | Honest empty state (fresh agent, no calls). |
| `proto-settings-voice-card` ↔ `build-settings-voice-suggested` | The canon's AI-voice-persona row (🎙 gradient tile · "Ava — US English, warm" · Change ▾) vs live; spoken-name row in the ✦-SUGGESTED state (nothing captured → "✦ Use 'Ava'" affordance + the default-literal note). |
| `build-settings-voice-persona-menu` | Persona picker OPEN (4 curated Aura-2 personas, current checked). |
| `build-settings-voice-inherited` | Workspace default set → field pre-filled, "Inherited from workspace" pill, override note (the locked capture spec's inherited rendering). |
| `build-settings-voice-confirmed` | Owner-confirmed agent name → "Confirmed" pill + the named-literal note. |
| `build-settings-voice-invalid` | "Dr. Smith" refused inline (plain-given-name validator — same verdict as the zod rail). |
| `build-senders-phone-chooser` | Settings → Phone & SMS connect drawer chooser (twilio/buy/port). |
| `build-senders-twilio-step1` | Live Twilio-connect step 1 (P2.1 surface, untouched values). |
| `build-senders-spoken-step` | The NEW optional "Who should calls say they are?" step on the live path — name typed, live preview of the disclosure wording (capture moment a). |
| `build-senders-buy-spoken-step` | The same step in the buy flow (designed placeholders — flow stays inert per P2.1). |

## Capture environment & disclosures

- Local stack: web `next start` :3000 → api :3001 → Postgres 16 + RLS
  (`clientforce_app`), dev-token auth, `VOICE_SANDBOX` default-ON. The QUEUED
  call and the refusal Logs rows were produced by driving the REAL
  `POST /agents/:id/calls` endpoint; the completed call's transcript rows were
  seeded byte-shaped as `persistTranscript` writes them.
- Prototype rendered from the repo file with its pinned unpkg React/Babel
  served from local npm tarballs (the sandbox proxy blocks unpkg; bytes are
  the pinned versions'). Google Fonts blocked in BOTH prototype and build
  captures alike — typography falls back identically, geometry/copy/color
  comparisons unaffected.

## Deviations (logged in PROGRESS.md, DEC-078(7))

- Outcome vocabulary is the deterministic call-status set
  (Completed/No answer/Busy/Failed/Canceled) — the canon's
  Booked/Interested/Voicemail outcomes require call tools + voicemail
  detection (Q-022). Pill styling reuses the canon's `callOut` colors.
- The dark recording player + "⬇ Recording" are honest-absent: recording is
  OFF by default (owner lock) and this unit ships constants only — the
  transcript is the record.
- The "✦ AI summary" card is honest-absent (no summarizer shipped).
- Transcript speakers label `Agent` / lead-first-name (the canon's persona
  names are seed copy; the agent label never claims an unconfirmed name).
- Voice stays out of the Inbox per the canon's own "☎ Phone calls live in the
  Calls tab" footnote (D1).

# §8 evidence — G2 · Guided mode, email (DEC-071, PR #82)

Guided-mode surfaces are **designed sections with no prototype anchor**
(DEC-065(6)/DEC-070(6) waiver — §0 card/label/drawer conventions), so this set
is build-only at 1440×900, captured off the real local stack: Postgres 16
(migrated + seeded) + Redis + api + worker + web, dev sign-in. **The model is
a deterministic prompt-driven fake served over `ANTHROPIC_BASE_URL`**
(disclosed — the exact G1 capture discipline; no network AI): every
compose-preview below ran the REAL api → gateway → `composer.email@v1` → the
real deterministic checks → the real bounded retry. The fake personalizes
only from the prompt's lead block, grounds only on facts in the cached
context block, and pastes the brief's subject hint verbatim (a naive-model
failure mode) — which is what makes the subject trap drivable through the
real UI.

| Shot | What it proves |
| --- | --- |
| `build-wizard-mixed-mode-step2.png` | The **mixed-mode step-2 view**: scripted step 1 card + guided EMAIL brief card ("✦ Composed at send" · **2 credits / send** · objective · **Subject hint** line · bullets) + guided SMS brief card (3 credits) in one sequence. Real CampaignGraph row (v7 shape), wizard resumed via B6 draft state |
| `build-wizard-email-brief-editor.png` | The **email brief variant** of the 560px drawer: email chips, email-aware compose note (subject rules + "the unsubscribe footer is always added by the platform"), objective, **Subject hint field**, bullets, mustSay chips |
| `build-preview-composed-subject.png` | **REAL `POST /planner/compose-preview`** → composed **subject card + body card** ("The number behind the audit" / grounded, personalized body) + the api's own caption: "The unsubscribe footer is appended at send time. 2 credits per real send (display only for now)" |
| `build-preview-subject-refused.png` | The **subject-check refusal proof**: a clickbait hint ("quick question about the audit!!") typed into the drawer and saved through the REAL `PUT /planner/graph` (owner-typed words are deliberately unvalidated at save, DEC-065), then recomposed — the REAL `SUBJECT_RULE` checker walked the bounded retry to the typed refusal: "⚠ Composer refused — nothing would send · SUBJECT_RULE — contains an exclamation mark; contains banned pattern(s): \"quick question\". The same check pauses a real lead instead of sending unchecked copy." The dirty hint is visible on the step card behind the drawer; restored to the clean hint after the shot |
| `build-steps-email-brief-card.png` | Steps tab **email brief card** (channel-true chips, per-channel credits, subject hint) beside the scripted + sms cards, live stats line intact |
| `build-inbox-guided-email-thread.png` | The **composed email in the Inbox thread** — the boundary-appended footer (company address + exactly one `Unsubscribe:` line) visible at the end of the guided outbound |
| `build-logs-email-refusal-row.png` | The `email.compose_refused.v1` **amber Logs row**: "Composer refused the email for Sam Okafor — SUBJECT_RULE (contains banned pattern(s): \"quick question\"). The lead is paused; nothing was sent." |
| `build-settings-compose-messages.png` | Settings → Message composing widened to email + SMS ("How this agent writes messages", footer-by-platform copy, applies-to-future-sends footnote) |

Disclosures (G1 precedent): the fake model as above; the ACTIVE agent's
graph/messages/events are fixture rows inserted byte-shaped as the planner
emits, `sendStep` persists (footer appended once, provenance meta), and
`recordComposeRefused` records — the Inbox/Logs/Steps shots render those real
rows through the real api; the worker heartbeat key was written during
capture (M1a precedent). Real-Sonnet evidence lands via the
`guided-email-live-proof` workflow_dispatch (variety · grounding ·
footer-once cage · mixed-mode w/ scripted-meta regression + real threading ·
trap-brief refusal → pause + Event row through the real bus), the G2 twin of
G1's proof.

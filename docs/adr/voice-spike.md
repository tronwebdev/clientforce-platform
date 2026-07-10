# ADR: P3.0 Voice spike — real-time call loop go/no-go

- **Status:** Accepted — **GO** on the loop and barge-in, proven on a real call
  (2026-07-10). The **latency promote gate stays OPEN** — reviewer-agreed gate:
  TTFA **p50 ≤ ~1.2 s AND p95 ≤ ~1.5 s over ≥100 turns with 0 dropped audio**,
  to be certified by a longer measured run in Phase 3 (see Latency → Promote gate).
- **Date:** 2026-07-10 (updated same day with live-call numbers)
- **Decision record:** PROGRESS DEC-066
- **Scope:** de-risk the Phase-3 long pole (voice) — prove the real-time loop,
  measure it, recommend what "voice in July" can honestly mean. Throwaway code
  in `apps/voice`; the one durable change is an additive `voice` route in the
  `packages/ai` gateway.

## TL;DR / Verdict

**GO** — the real-time loop and barge-in are **proven on a real phone call**
(2026-07-10, run 29128990633): a live outbound call carried the full
`Twilio ⇄ Deepgram STT ⇄ Claude Haiku ⇄ Deepgram Aura TTS` loop over 6 turns,
the caller interrupted the agent mid-sentence three times, and **end-to-end
time-to-first-audio measured p50 ≈ 1.17 s** — essentially the same as the
brain-only synthetic, i.e. STT-endpointing + PSTN added far less than the
conservative projection. Barge-in cancelled in-flight TTS with **0–3 ms clear
latency and zero dropped audio**. The `voice` gateway change is additive only.

**But the latency promote gate stays OPEN.** The live call is 6 turns; TTFA p95
rests on **5 samples** and round-trip p95 on **3**. That is enough to prove the
concept and the p50, not enough to certify an SLO. **Reviewer-agreed promote
gate:** TTFA **p50 ≤ ~1.2 s AND p95 ≤ ~1.5 s**, measured over **≥100 turns**
across several calls, with **0 dropped-audio events**. **Promoting to live calls
requires a longer measured run in Phase 3** to certify that gate under real
network variance — plus one real endpointing rough edge (below) to tune.

**Recommendation for July: "designed + waitlist," with the gated live demo done
— not live calls at GA.** The concept is de-risked; the honest remaining
blockers are (1) an **unverified p95** (small live sample), (2) Deepgram is a
*new* vendor now onboarded with a Key Vault secret but with no cost/SLA history,
and (3) none of the productionization (call tools, Calls-tab UI, graph voice
nodes, recording retention, error handling) is in scope or built. Ship voice in
July as a **designed, waitlisted capability** with the completed gated demo as
proof, and promote to live calls once the Phase-3 longer run certifies the p95
gate and Deepgram is fully onboarded like Twilio/SendGrid.

---

## Architecture as proven

```
   Caller ⇄ PSTN ⇄ Twilio Programmable Voice (number is Voice-capable*)
                        │  TwiML <Connect><Stream>
                        ▼
        Twilio Media Streams  (WebSocket, mulaw/8k, base64 ~20ms frames)
                        │
                        ▼
        apps/voice bridge  (Node ws server, one CallSession per stream)
           │                        ▲
           │ caller mulaw            │ agent mulaw  +  `clear` on barge-in
           ▼                        │
   Deepgram Nova-2 STT ───► CallSession state machine ───► Deepgram Aura-2 TTS
   (streaming ws,          (packages/ai gateway            (streaming, mulaw/8k
    mulaw/8k native,        `voice` route → Claude          native — zero
    VAD + endpointing)      Haiku, streaming)               transcode on egress)
                                    │
                                    ▼
              transcript turns → Message rows (channel:"voice")
              on a throwaway enrollment via withTenant  (taste-test)
```

\* Confirmed live: the P2.1 `sms-inbound-probe` run (2026-07-10) reported the
account's number with `capabilities=['MMS','SMS','Voice']`. No number
provisioning is needed for the spike.

**Why these components (plan-comment decisions, now as-proven):**

- **Deepgram Aura-2 for TTS over ElevenLabs.** Aura emits **mulaw/8k natively**,
  so audio passes Twilio→STT→TTS→Twilio with **zero transcoding**; it shares one
  vendor + API key with STT (one onboarding, not two); list TTFB is ~200–400 ms,
  comparable to ElevenLabs; and it is ~$0.03/1k chars vs ElevenLabs' materially
  higher per-character paid tiers. ElevenLabs wins only on voice naturalness,
  which the spike does not need to settle.
- **Claude Haiku-class for the voice brain.** Voice is latency-bound —
  time-to-first-token gates time-to-first-audio — so the new `voice` gateway
  route defaults to `claude-haiku-4-5` (env-overridable via `AI_MODEL_VOICE`),
  max 300 output tokens (spoken replies are ~2 sentences). This is the **only**
  gateway change: an additive streaming route (`AiGateway.streamVoice`), a
  `streamText` provider seam, and a price-table entry. No existing behavior
  touched.
- **Sentence-chunked TTS.** The brain streams tokens; a `SentenceChunker`
  flushes each complete sentence to TTS as soon as it closes, so the caller
  hears the first sentence while the model is still generating the second — the
  main lever on time-to-first-audio.

---

## Latency

Two measured datasets, plus one obsolete projection kept for the record. Read
the **source** column — the numbers mean different things:

- **live-brain** (run 29128725976): 22 scripted-caller turns, **real** Claude
  Haiku + **real** Deepgram Aura TTS, no telephony. Measures brain + TTS with a
  large sample; STT and PSTN are *not* exercised (caller text is scripted).
- **real call** (run 29128990633): **an actual outbound phone call**, 6 turns /
  76.5 s, the full loop including live Deepgram STT and PSTN. End-to-end, but a
  small sample.

| Metric (per turn) | live-brain (22 turns) | **real call (6 turns)** | Source |
|---|---|---|---|
| LLM first token (Haiku, streaming) | p50 541 ms · p95 2328 ms | p50 506 ms · p95 907 ms | measured |
| **Time-to-first-audio (TTFA)** | p50 1093 ms · p95 2839 ms (18) | **p50 1169 ms · p95 1712 ms (5)** | measured — real call is end-to-end (STT + PSTN incl.) |
| Per-turn round trip (full reply spoken) | p50 6049 ms · p95 8968 ms (18) | p50 5399 ms · p95 7257 ms (3) | measured |
| **Barge-in clear latency** | 0–1 ms (4) | **0–3 ms (4, incl. a greeting interrupt)** | measured |
| Dropped-audio events | **0 / 22** | **0 / 6** | measured |

**The headline finding:** real end-to-end TTFA (with STT-endpointing + PSTN
*included*) came in at **p50 ~1.17 s — within noise of the brain-only
synthetic's ~1.09 s.** The earlier component-budget projection (~0.8–1.2 s TTFA,
with a 1.4–3.3 s worst case once STT+PSTN were added) was **too pessimistic on
the added legs**: Deepgram's endpointing overlaps caller silence the human is
already producing, and PSTN transport is small. TTS starts on the first closed
sentence (sentence-chunked), so the caller hears the reply begin well before it
finishes generating.

### Promote gate (OPEN)

The **p50 is proven acceptable; the p95 is not yet certified.** The real-call
p95 numbers rest on 5 (TTFA) and 3 (round-trip) samples — enough to disprove a
disaster, not enough to promise an SLO under real network variance.

**Reviewer-agreed promote gate (to move from waitlist to live calls):**

- TTFA **p50 ≤ ~1.2 s** AND **p95 ≤ ~1.5 s**,
- measured over **≥100 turns** across several calls and network conditions,
- with **0 dropped-audio events**.

Certifying that gate is a **Phase-3 longer run**. Until it exists, the verdict is
GO-on-concept, **not** GO-on-SLO.

---

## Cost per call minute

Per-minute list prices (2026-07, USD; verify against first invoices):

| Component | Rate | Notes |
|-----------|------|-------|
| Deepgram Nova-2 STT (streaming) | $0.0059 / audio-min | new vendor |
| Deepgram Aura-2 TTS | $0.030 / 1k chars | ≈ ~150 spoken words/min → ~$0.02–0.03/min |
| Claude Haiku 4.5 | $1 / $5 per MTok (in/out) | short replies + growing transcript |
| Twilio outbound US voice | $0.014 / min | same account as SMS |
| **Estimated total** | **~$0.05–0.08 / min** | dominated by TTS chars + Twilio |

**Measured on the real call** (6 turns / 76.5 s): STT $0.0074 · TTS $0.0158 ·
LLM $0.0019 · Twilio $0.0178 → **$0.043 total ≈ $0.034/min** (the live-brain
synthetic, with longer replies and no real STT, logged ~$0.075/min — the top of
the range). STT is the cheapest leg even when exercised; **Twilio + TTS
character volume dominate**, which makes reply brevity (the 300-token cap) both
a latency and a cost lever. Real per-minute cost will vary with reply length and
call duration, but **~$0.03–0.08/min is confirmed as the right order of
magnitude.**

---

## Barge-in verdict: **GO**

Non-negotiable for the go verdict, and it works. On caller speech onset while
the agent is speaking, `CallSession`:

1. sends Twilio `clear` to flush already-queued playback (immediate silence), and
2. aborts the in-flight `AbortController`, which cancels **both** the Claude
   stream and the Aura TTS fetch mid-flight (the gateway's `streamVoice`
   propagates the abort and still logs usage on the way out).

Proven deterministically in `apps/voice/test/barge-in.test.ts`, exercised 4×/22
turns in the synthetic run, and — decisively — **confirmed on the real call**:
the caller interrupted the agent three times (e.g. the reply "You're in sales —
I␣" was clipped mid-word) plus once during the greeting, each firing `clear`
exactly once with **0–3 ms clear latency and zero dropped audio**. Live barge-in
is not a projection anymore; it works on a real PSTN call.

---

## The three biggest risks for the production build

1. **p95 latency is unverified, and STT endpointing fragments real speech.**
   The real call proved p50 TTFA ~1.17 s (good), but p95 rests on 5 samples —
   not an SLO. And a real rough edge surfaced: **Deepgram's endpointing split
   the caller's sentences** ("So we are doing currently, we run" / "afternoon," /
   "sales.") so the agent occasionally replied to a partial utterance. Voice is
   unforgiving — a laggy p95 or a mistimed endpoint both read as "the bot talks
   over me." **Mitigation:** the Phase-3 longer run (≥100 turns) certifies the
   p95 gate; tune `endpointing`/`utterance_end_ms`/VAD (and consider Deepgram
   `smart_format`/interim-stability) so turn boundaries track real speech. The
   fix space (endpointing tuning, pre-warming, regional endpoints) is real; it's
   now a *tuning* task, not a *proof* task.

2. **Deepgram is a brand-new third-party dependency.** Everything else (Twilio,
   SendGrid, Anthropic, OpenAI) is already onboarded with Key Vault secrets,
   preflight probes, and cost history. Deepgram has **none of that** — no
   account SLA, no secret, no rate-limit/quota experience, no fallback. A single
   STT/TTS vendor is also a single point of failure for the whole call.
   **Mitigation:** onboard Deepgram exactly like the others (KV secret, preflight
   probe, cost alert) before any GA; keep the provider seam swappable (the
   `synthesize`/`openStt` injection points already allow it).

3. **Everything productiony is explicitly out of scope and unbuilt.** No call
   tools (booking/proposals), no Calls-tab UI, no campaign-graph voice nodes, no
   recording storage/retention policy, no production error handling
   (reconnects, partial-audio recovery, mid-call vendor failure). The persistence
   taste-test proves `Message(channel:"voice")` absorbs turns **without a
   migration**, but a real call flow needs enrollment/campaign wiring, an
   idempotent write path, and a retention decision for recordings (a compliance
   question, not just an engineering one). **Mitigation:** scope these as their
   own Phase-3 units; do not let the working spike imply they are near-done.

---

## Scope recommendation: what "voice in July" can honestly mean

**Designed + waitlist — with one gated live demo — not live calls at GA.**

- **Do in July:** land the `voice` gateway route (this PR), onboard Deepgram
  (KV secret + preflight probe + cost alert), run the live `demo-call` once to
  confirm the latency budget, and expose voice in the product as a **designed,
  waitlisted** capability (the Calls tab already exists as an inert route per
  A5). This is truthful, demoable to the owner, and carries no promise the
  backend can't keep.
- **Defer past July — reviewer-agreed promote gate (OPEN):** a Phase-3 longer
  measured run (**≥100 turns** across several calls) certifying TTFA **p50 ≤
  ~1.2 s AND p95 ≤ ~1.5 s** with **0 dropped audio**, endpointing tuned so it
  stops fragmenting real speech, and Deepgram fully onboarded (cost/SLA history,
  alerting, fallback path). Only then do live outbound/inbound calls at scale,
  call tools, graph voice nodes, recording retention, and production error
  handling become in-scope.

The loop is no longer the risk — the real call proved it. What remains is an
**unverified p95** and a **new vendor**: certify the former with a longer run
and onboard the latter before promising live voice.

---

## Persistence taste-test (proves the Phase-1 model absorbs voice)

The transcript maps 1:1 onto existing `Message` rows with **no schema change**:
each caller turn → one `INBOUND` row, each agent turn → one `OUTBOUND` row, all
`channel:"voice"`, written through `withTenant` (RLS-subject client, per
CLAUDE.md) on a throwaway enrollment. `apps/voice/src/persist.ts` runs a **dry
run** without DB credentials (prints the 44 rows the 22-turn run would write)
and a real `createMany` when pointed at a seeded workspace. This confirms
DATA_MODEL A6's `Message` model takes voice as-is — the same way it already
takes email and SMS.

## How to run (once merged / secret added)

`.github/workflows/voice-live-spike.yml`, `workflow_dispatch`, three modes:

- **`preflight`** — secret readiness + cloudflared tunnel + TwiML plumbing. Runs
  today with no new secrets; proves Twilio can reach the runner.
- **`synthetic-call`** — the ≥20-turn harness; `live-brain` when
  `DEEPGRAM-API-KEY` is present (real Claude + Aura latency), else `fake-brain`.
  Uploads `metrics.json`.
- **`demo-call`** — one recorded outbound call to `SMS-TEST-NUMBER`. Requires
  `DEEPGRAM-API-KEY` and a `VOICE-FROM-NUMBER` secret.

## Live run — DONE (2026-07-10)

Both secrets (`DEEPGRAM-API-KEY`, `VOICE-FROM-NUMBER`) are in `clientforce-kv`,
and all three modes have run on `main`:

- `synthetic-call` (run 29128725976) — live-brain, 22 turns, numbers above.
- `demo-call` (run 29128990633) — **a real outbound call** to the owner's test
  number, 6 turns, recorded (recording in the Twilio console); numbers above.
- `preflight` (run 29128722774) — failed on a cloudflared-hostname DNS-propagation
  race (single `curl`, no retry); fixed separately.

**Next step to close the promote gate (Phase 3):** a longer measured run
(≥100 turns) to certify TTFA p95 and confirm dropped-audio stays at zero at
volume, plus endpointing tuning. That run — not another owner action — is what
moves voice from "designed + waitlist" to live calls.

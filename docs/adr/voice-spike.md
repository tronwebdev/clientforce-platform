# ADR: P3.0 Voice spike — real-time call loop go/no-go

- **Status:** Proposed (spike complete; awaits owner-gated live call for final numbers)
- **Date:** 2026-07-10
- **Decision record:** PROGRESS DEC-066
- **Scope:** de-risk the Phase-3 long pole (voice) — prove the real-time loop,
  measure it, recommend what "voice in July" can honestly mean. Throwaway code
  in `apps/voice`; the one durable change is an additive `voice` route in the
  `packages/ai` gateway.

## TL;DR / Verdict

The loop is **architecturally proven and barge-in works**, but the **latency and
cost tables below are not yet backed by a real phone call** — the live path is
blocked on one owner action (adding `DEEPGRAM-API-KEY` to Key Vault) plus
answering a demo call. Everything up to the vendor boundary is built, tested,
and green: Twilio Media Streams framing, a streaming `Deepgram STT → Claude →
Deepgram Aura TTS` loop, sentence-chunked TTS for low time-to-first-audio, and
**deterministic barge-in cancellation** (caller speech drops in-flight TTS via
Twilio `clear` + aborting the LLM/TTS streams).

**Recommendation for July: "designed + waitlist," not live calls at GA.** The
loop mechanics are a go; the honest blockers are (1) no live-measured latency
yet, (2) Deepgram is a *new* vendor with no account, secret, or cost history in
this stack, and (3) none of the productionization (call tools, Calls-tab UI,
graph voice nodes, recording retention, error handling) is in scope or built.
Ship voice in July as a **designed, waitlisted capability** with a single
gated live demo, and promote to live calls once the live run confirms the
latency budget and Deepgram is onboarded like Twilio/SendGrid were.

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

**⚠️ These are two different things — read the source column.** The spike ran a
`fake-brain` synthetic harness (22 scripted caller turns, no telephony, no
Deepgram/Claude keys) that proves loop **mechanics** but whose timings are
dominated by a fake TTS that emits silence in real time. The **live** column is
a component-budget projection from vendor specs, to be replaced by the real run.

| Metric (per turn)         | Synthetic (mechanics only) | Live budget (projected) | Source |
|---------------------------|----------------------------|-------------------------|--------|
| Endpointing (caller stops → STT final) | n/a (bypassed)  | ~300 ms (Deepgram `endpointing=300`) | vendor |
| LLM first token           | ~12 ms (fake)              | ~300–500 ms (Haiku streaming) | projected |
| **Time-to-first-audio (TTFA)** | p50 94 ms / p95 191 ms (fake TTS) | **~0.8–1.2 s** (STT final + LLM first token + Aura TTFB) | projected |
| Per-turn round trip (full reply spoken) | p50 4.6 s / p95 6.7 s (fake real-time silence) | **~1.5–3 s** depending on reply length | projected |
| Dropped-audio events      | **0 / 22 turns**          | to be measured | synthetic |
| PSTN transport (each way) | n/a                       | ~100–300 ms (caller-heard only) | vendor |

**What the synthetic run genuinely establishes:** the state machine sustains 22
back-to-back turns with **0 dropped-audio events**, TTS starts on the first
closed sentence (not the whole reply), and per-turn usage/cost accounting fires
exactly once per turn through the gateway hook. The **live TTFA number is the
single most important unknown** and the reason for the gated demo call.

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

The synthetic run's cost model (wired end-to-end, TTS+LLM+Twilio) produced
**~$0.042/min** on short scripted replies; real calls with fuller replies land
nearer the top of the range. STT is nearly free; **TTS character volume is the
cost driver**, which makes reply brevity (the 300-token cap) both a latency and
a cost lever.

---

## Barge-in verdict: **GO**

Non-negotiable for the go verdict, and it works. On caller speech onset while
the agent is speaking, `CallSession`:

1. sends Twilio `clear` to flush already-queued playback (immediate silence), and
2. aborts the in-flight `AbortController`, which cancels **both** the Claude
   stream and the Aura TTS fetch mid-flight (the gateway's `streamVoice`
   propagates the abort and still logs usage on the way out).

Proven deterministically in `apps/voice/test/barge-in.test.ts` and exercised
4×/22 turns in the synthetic run: every barge-in fired `clear` exactly once,
marked the turn `interrupted`, and recorded no full round-trip for the cut turn.
The **clear-latency will be re-measured live** (the synthetic harness fires the
interrupt in-process, so its 0 ms figure is not meaningful); the mechanism
itself is not in doubt.

---

## The three biggest risks for the production build

1. **Live latency is unmeasured, and voice is unforgiving.** TTFA above ~1.2 s
   reads as a laggy, talk-over-y call. The projection is a budget, not a
   measurement — the real STT-endpointing + Haiku-first-token + Aura-TTFB sum on
   a real PSTN call is the gate. If it lands high, the fix space (lower
   endpointing, smaller model, pre-warming, regional endpoints) is real but
   unbudgeted. **Mitigation:** run the live `synthetic-call`/`demo-call` modes
   the moment `DEEPGRAM-API-KEY` lands; treat measured TTFA as the promote gate.

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
- **Defer past July (promote gate = measured live TTFA ≤ ~1.2 s p95 + Deepgram
  onboarded):** live outbound/inbound calls at scale, call tools, graph voice
  nodes, recording retention, and production error handling.

The loop is not the risk anymore; the **unmeasured live latency and the new
vendor** are. Buy those down with one real call before promising live voice.

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

## Owner action to unlock the live numbers (non-technical, step by step)

1. Create a Deepgram account at deepgram.com and copy its **API key** (Deepgram
   dashboard → **API Keys** → **Create a Key**).
2. Add it to Azure Key Vault as a secret named **`DEEPGRAM-API-KEY`**
   (Azure Portal → the `clientforce-kv` vault → **Secrets** → **Generate/Import**
   → Name = `DEEPGRAM-API-KEY`, Value = the key → **Create**).
3. Add the Voice-capable Twilio number in E.164 form (e.g. `+1...`) as a secret
   named **`VOICE-FROM-NUMBER`** the same way.
4. Tell us, and we run `voice-live-spike` in `demo-call` mode — your test phone
   rings, you have a short chat, and we attach the recording + real latency
   table to this PR.

Until then, this ADR ships with synthetic-mechanics numbers and a projected
live budget, clearly labelled as such.

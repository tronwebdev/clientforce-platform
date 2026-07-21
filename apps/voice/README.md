# apps/voice — the production voice call-session service (P3.1, DEC-078)

The durable home per `ARCHITECTURE.md §5` — the P3.0 spike (DEC-066) proved
the loop on a real call; this service is its production build. The ADR
(`docs/adr/voice-spike.md`) promote gate is the operating bar: TTFA p50 ≤
~1.2 s AND p95 ≤ ~1.5 s over ≥100 turns, 0 dropped audio — plus P3.1's zero
mid-utterance replies.

```
caller ⇄ Twilio Programmable Voice
             ⇄ Media Streams WebSocket (mulaw/8k, callId+workspaceId as stream params)
             ⇄ this service
                   ├─ Deepgram STT   (streaming, tuned endpointing — config.ts)
                   ├─ TurnGate       (deterministic turn commit — the anti-fragmentation engine)
                   ├─ brain          (packages/ai `voice` route, composer.voice@v1 system prompt)
                   └─ Deepgram Aura-2 (persona voice, sentence-chunked, zero transcode)
```

What the session guarantees (owner-locked, see the PR #93 plan):

- **Disclosure first** — the locked constant literal (named/default variant by
  the spoken-name resolution chain), spoken before any composed turn, never
  composed. Recording sentence renders only when the workspace flag is ON
  (default OFF).
- **Zero mid-utterance replies** — `TurnGate` commits a turn only on a
  complete thought (terminal punctuation at speech_final), a continuation
  window expiry, or Deepgram's hard UtteranceEnd. The ADR's real fragmented
  call is a pinned unit fixture.
- **Barge-in exactly as proven** — caller speech onset → Twilio `clear` +
  abort of the in-flight LLM+TTS; usage still logged on abort.
- **Latency masking** — a pre-rendered ack clip if the reply keeps the caller
  waiting past `VOICE_ACK_AFTER_MS`; never counted as reply TTFA.
- **Deterministic per-turn checks pre-TTS** — neverSay / token syntax /
  spoken register (URLs, markdown, emoji); a violation swaps in the constant
  fallback line and emits `voice.compose_refused.v1`.
- **Never a hung line** — provider failure speaks the constant goodbye and
  ends the call (`call.failed.v1`); idle + max-duration timeouts close
  politely.
- **Transcript = the record** — every turn an idempotent
  `Message(channel:"voice")` row (`providerMessageId = voice:{sid}:{i}`),
  regardless of the recording setting; `Call` row finalized with duration,
  outcome, cost (+ the cost alert threshold).

Modes: **product** (DATABASE_URL set, callId/workspaceId on the stream —
full context via RLS + persistence) and **standalone** (the certification
harness `src/certify.ts` and the CI demo rig — same session code, fixture
context, metrics only).

Dials happen in `apps/api` (voice module) behind the `assertDialAllowed`
rails — this service never bypasses them.

Run the certification: `.github/workflows/voice-certification.yml`
(workflow_dispatch) — `certify` mode aggregates the gate table; `demo-call`
dials the owner's test number through THIS service.

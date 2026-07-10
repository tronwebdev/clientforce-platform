# apps/voice — P3.0 voice spike (throwaway)

**This is a SPIKE, not a build** (Phase 3 de-risk, DEC-064). The deliverable is
`docs/adr/voice-spike.md` — a measured go/no-go on the real-time voice loop —
not this code. Nothing here is production-quality on purpose: no retries beyond
what the loop needs, no persistence beyond the taste-test, no UI. Do not extend
this directory; the production build starts fresh from the ADR.

## What it proves

```
caller ⇄ Twilio Programmable Voice (number verified Voice-capable)
              ⇄ Media Streams WebSocket (mulaw/8k, base64 frames)
              ⇄ this bridge (apps/voice)
                    ├─ Deepgram STT   (streaming websocket, mulaw/8k native)
                    ├─ Claude         (packages/ai gateway, new `voice` route, streaming)
                    └─ Deepgram Aura  (TTS, streams mulaw/8k back — zero transcode)
```

- **Barge-in** — caller speech cancels in-flight TTS (Twilio `clear` + abort of
  the LLM/TTS streams). Non-negotiable for the go verdict.
- **Metrics** — time-to-first-audio and per-turn round-trip (p50/p95 over ≥20
  turns), dropped-audio events, cost per call minute.
- **Persistence taste-test** — transcript turns land as `Message` rows
  (`channel: "voice"`) on a throwaway enrollment via `withTenant` — proves the
  Phase-1 data model absorbs calls without migration.

## How it runs

Live measurement rides the P2.1 probe pattern:
`.github/workflows/voice-live-spike.yml` (workflow_dispatch, staging OIDC →
`clientforce-kv`), which tunnels the runner via a cloudflared quick tunnel and
places a real call. Modes:

- `preflight` — checks secret presence, tunnel reachability, TwiML plumbing.
  Runs without any new secrets.
- `synthetic-call` — Twilio↔Twilio conference; a `<Say>`-scripted caller leg
  drives ≥20 turns unattended (metrics without a human).
- `demo-call` — dials the owner's test number (`SMS-TEST-NUMBER`) for the one
  demo call.

Owner-gated inputs: `DEEPGRAM-API-KEY` Key Vault secret (not present as of
2026-07-10) and answering the demo call.

## Explicitly not built (per the spike charter)

Call tools (booking/proposals) · Calls-tab UI · campaign-graph voice nodes ·
recording storage/retention policy · production error handling.

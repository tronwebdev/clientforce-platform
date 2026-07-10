/**
 * Synthetic loop harness (P3.0). Drives the real CallSession through ≥20
 * scripted caller turns — including barge-ins — WITHOUT telephony, and writes
 * the same metrics.json the live bridge produces.
 *
 * Two modes, chosen by key presence:
 *   - live-brain  (ANTHROPIC_API_KEY + DEEPGRAM_API_KEY set): real
 *     gateway.streamVoice + real Aura TTS — measures true LLM + TTS latency.
 *     The only thing faked is the caller (scripted text, no PSTN), so numbers
 *     are a lower bound: a real call adds STT finalization + PSTN transport.
 *   - fake-brain  (keys absent): deterministic fake provider + fake TTS — proves
 *     loop mechanics and barge-in cancellation with zero network. Latency
 *     figures are synthetic and labelled as such.
 *
 * Env: METRICS_OUT (default ./metrics.json), TURNS (default 22).
 */
import { writeFileSync } from "node:fs";
import { AiGateway } from "@clientforce/ai";
import type { CompletionProvider, StreamEvent, StreamParams } from "@clientforce/ai";
import { CallSession } from "./call-session";
import { MetricsCollector } from "./metrics";
import { createVoiceGateway } from "./brain";
import { synthesizeAura } from "./deepgram";

const CALLER_SCRIPT = [
  "Hey, who is this?",
  "Oh okay. I run a small marketing agency.",
  "We do email campaigns mostly, some paid ads.",
  "About a dozen clients right now.",
  "Honestly deliverability is our biggest headache.",
  "Emails keep landing in spam.",
  "What does your product actually do?",
  "Interesting. Does it handle the sending too?",
  "How is that different from what we use now?",
  "We're on a legacy tool, it's clunky.",
  "Pricing is a concern for us.",
  "Can it do SMS as well as email?",
  "That could be useful for reminders.",
  "How long does setup take?",
  "Do you integrate with our CRM?",
  "We use a custom spreadsheet, honestly.",
  "Okay, that's fair.",
  "Who else uses this?",
  "Sure, a demo could make sense.",
  "Next Tuesday afternoon works.",
  "Send it to my work email.",
  "Great, talk then. Bye.",
];

/** Deterministic fake brain — short canned replies, no network. */
function fakeProvider(): CompletionProvider {
  const replies = [
    "This is the Clientforce assistant. Good to reach you.",
    "That sounds like a solid setup. What is working well for you?",
    "Deliverability is exactly what we help with. We manage sender health end to end.",
    "We handle sending, warmup, and suppression automatically so more mail lands in the inbox.",
    "Setup usually takes under a day. Would a short demo be useful?",
  ];
  let n = 0;
  return {
    completeText: async () => {
      throw new Error("not used");
    },
    completeTool: async () => {
      throw new Error("not used");
    },
    streamText: async function* (p: StreamParams): AsyncIterable<StreamEvent> {
      const text = replies[n++ % replies.length] ?? "Okay.";
      for (const word of text.split(" ")) {
        if (p.signal.aborted) return;
        await sleep(12);
        if (p.signal.aborted) return;
        yield { type: "delta", text: `${word} ` };
      }
      yield { type: "done", usage: { inputTokens: 120, outputTokens: text.split(" ").length } };
    },
  };
}

/** Fake TTS: yields silence frames sized to the text at real-time cadence. */
async function* fakeSynthesize(
  _key: string,
  text: string,
  signal: AbortSignal,
): AsyncGenerator<Buffer> {
  // ~14 chars/sec spoken → mulaw bytes; 160-byte (20ms) frames.
  const frames = Math.max(1, Math.ceil((text.length / 14) * 50));
  for (let i = 0; i < frames; i++) {
    if (signal.aborted) return;
    await sleep(20);
    if (signal.aborted) return;
    yield Buffer.alloc(160, 0xff);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const metricsOut = process.env.METRICS_OUT ?? "./metrics.json";
  const turnCount = Math.max(20, Number(process.env.TURNS ?? CALLER_SCRIPT.length));
  const hasKeys = Boolean(process.env.ANTHROPIC_API_KEY) && Boolean(process.env.DEEPGRAM_API_KEY);
  const metrics = new MetricsCollector();

  const gateway: AiGateway = hasKeys
    ? createVoiceGateway(metrics)
    : new AiGateway({ provider: fakeProvider(), onUsage: (r) => (metrics.llmCostUsd += r.estimatedCostUsd) });

  const audioSink: Buffer[] = [];
  const session = new CallSession({
    gateway,
    metrics,
    deepgramKey: process.env.DEEPGRAM_API_KEY ?? "fake",
    sendAudio: (mulaw) => audioSink.push(mulaw),
    clearPlayback: () => audioSink.splice(0),
    synthesize: hasKeys ? synthesizeAura : fakeSynthesize,
  });

  metrics.markCallStart();
  console.log(`[synthetic] mode=${hasKeys ? "live-brain" : "fake-brain"} turns=${turnCount}`);

  for (let i = 0; i < turnCount; i++) {
    const line = CALLER_SCRIPT[i % CALLER_SCRIPT.length] ?? "Okay.";
    // Barge in on ~every 5th turn to exercise cancellation.
    const bargeInAfterMs = i > 0 && i % 5 === 0 ? 150 : undefined;
    await session.driveTurn(line, bargeInAfterMs);
  }

  session.close();
  const report = metrics.report();
  writeFileSync(metricsOut, JSON.stringify(report, null, 2));
  console.log(
    `[synthetic] ${report.turns} turns, ${report.bargeIns.length} barge-ins, ` +
      `TTFA p50=${report.ttfaMs.p50}ms p95=${report.ttfaMs.p95}ms, ` +
      `RTT p50=${report.roundTripMs.p50}ms p95=${report.roundTripMs.p95}ms → ${metricsOut}`,
  );
}

void main().catch((err) => {
  console.error("[synthetic] failed:", (err as Error).message);
  process.exitCode = 1;
});

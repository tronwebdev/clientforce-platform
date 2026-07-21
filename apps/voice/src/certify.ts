/**
 * Certification harness (P3.1, DEC-078) — the ≥100-turn run that closes the
 * ADR's promote gate, as AMENDED by the owner rulings of 2026-07-15 after the
 * 7-run falsification trail: TTFA p50 ≤ 1.2s AND p95 ≤ 2.0s with the ack-mask
 * invariant ≥95% (DEC-089), 0 dropped audio, and mid-utterance replies ≤7% of
 * turns (DEC-088 — the residual is STT-layer, VAD-bounded), measured from the
 * turn-committing STT event (the ADR's anchor). A scheduled run keeps the
 * gate monitored on main (DEC-088).
 *
 * Paired-bot, STT-in-the-loop (plan D13): a caller bot speaks REAL AUDIO
 * (Aura TTS in a different voice) into the PRODUCTION CallSession at
 * telephony cadence (160-byte/20ms mulaw frames + silence frames, exactly
 * like Twilio Media Streams), with ADVERSARIAL intra-utterance pauses — the
 * ADR's real fragmentation pattern ("…we run" / "afternoon," / "sales.") —
 * plus scripted barge-ins. Real Deepgram STT, real endpointing, real Haiku,
 * real Aura replies. PSTN is excluded by the gate's own anchor; the demo
 * call crosses real PSTN separately.
 *
 * A MID-UTTERANCE REPLY is judged by the bot, which knows its own script:
 * any agent audio that starts while the bot is still inside one of its
 * multi-segment utterances (streaming a segment or inside an intra-utterance
 * pause) counts. The disclosure (turn 0) is excluded — the bot hasn't spoken.
 *
 * Env: DEEPGRAM_API_KEY + ANTHROPIC_API_KEY (required), CERT_SESSIONS
 * (default 6), CERT_OUT (default ./cert), VOICE_* tunables echo into the
 * table so every run is reproducible.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadVoiceConfig } from "./config";
import { demoCallContext } from "./demo-context";
import { synthesizeAura } from "./deepgram";
import { MetricsCollector, percentile } from "./metrics";
import { createVoiceGateway } from "./runtime";
import { CallSession } from "./session";
import { loadAckClips } from "./ack";

const FRAME_BYTES = 160; // 20ms of mulaw/8k
const FRAME_MS = 20;
/** The caller bot's voice — deliberately NOT an agent persona. */
const CALLER_VOICE = "aura-2-orion-en";

interface UtteranceSegment {
  text: string;
  /** Intra-utterance pause AFTER this segment — the adversarial fragmenter.
   *  Must sit between endpointing (500ms) and utterance_end (1500ms). */
  pauseMs?: number;
}

interface ScriptedUtterance {
  segments: UtteranceSegment[];
  /** Start speaking while the agent is mid-reply (real barge-in). */
  bargeIn?: boolean;
}

/** ~19 turns per dialogue; fragmented utterances model the ADR's real call. */
const DIALOGUE: ScriptedUtterance[] = [
  { segments: [{ text: "Hey, who is this?" }] },
  { segments: [{ text: "Oh okay. I run a small marketing agency." }] },
  {
    // The ADR's literal fragmentation case — MUST produce exactly one reply.
    segments: [
      { text: "So we are doing currently, we run", pauseMs: 700 },
      { text: "afternoon,", pauseMs: 650 },
      { text: "sales." },
    ],
  },
  { segments: [{ text: "About a dozen clients right now." }] },
  {
    segments: [
      { text: "Honestly deliverability is", pauseMs: 800 },
      { text: "our biggest headache." },
    ],
  },
  { segments: [{ text: "Emails keep landing in spam." }] },
  { segments: [{ text: "What does your product actually do?" }], bargeIn: true },
  { segments: [{ text: "Interesting. Does it handle the sending too?" }] },
  {
    segments: [
      { text: "How is that different from", pauseMs: 900 },
      { text: "what we use now?" },
    ],
  },
  { segments: [{ text: "We're on a legacy tool, it's clunky." }] },
  { segments: [{ text: "Pricing is a concern for us." }], bargeIn: true },
  { segments: [{ text: "Can it do SMS as well as email?" }] },
  {
    segments: [
      { text: "That could be useful", pauseMs: 750 },
      { text: "for reminders." },
    ],
  },
  { segments: [{ text: "How long does setup take?" }] },
  { segments: [{ text: "Do you integrate with our CRM?" }] },
  {
    segments: [
      { text: "We use a custom", pauseMs: 850 },
      { text: "spreadsheet, honestly." },
    ],
  },
  { segments: [{ text: "Okay, that's fair." }], bargeIn: true },
  { segments: [{ text: "Sure, a demo could make sense." }] },
  { segments: [{ text: "Great, talk then. Bye." }] },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const SILENCE_FRAME = Buffer.alloc(FRAME_BYTES, 0xff);

/**
 * The caller's audio transport — ONE writer, CONTINUOUS stream, exactly like
 * Twilio Media Streams: one 20ms frame every 20ms, speech when queued,
 * SILENCE otherwise. The first cert run proved why this must be a single
 * pump: a detached trailing-silence task overlapped the next utterance's
 * frames (two writers → garbled ~2× audio → phantom endpoints → 48 false
 * mid-utterance commits), and the frame gaps while the bot idled starved
 * Deepgram's socket until it closed (session 6's failure).
 */
class AudioPump {
  private queue: Buffer[] = [];
  private stopped = false;
  constructor(private readonly push: (frame: Buffer) => void) {}

  start(): void {
    void (async () => {
      while (!this.stopped) {
        this.push(this.queue.shift() ?? SILENCE_FRAME);
        await sleep(FRAME_MS);
      }
    })();
  }

  enqueueSpeech(audio: Buffer): void {
    for (let off = 0; off < audio.length; off += FRAME_BYTES) {
      const frame = audio.subarray(off, off + FRAME_BYTES);
      this.queue.push(frame.length === FRAME_BYTES ? frame : Buffer.concat([frame, SILENCE_FRAME]).subarray(0, FRAME_BYTES));
    }
  }

  enqueueSilence(ms: number): void {
    for (let t = 0; t < ms; t += FRAME_MS) this.queue.push(SILENCE_FRAME);
  }

  get pendingMs(): number {
    return this.queue.length * FRAME_MS;
  }

  stop(): void {
    this.stopped = true;
  }
}

/**
 * Trim near-silence padding off both clip edges so a scripted pause equals
 * its TRUE acoustic gap. Run 8 localized the residual mid-utterance events
 * here: Aura clips carry ~300-400ms of edge padding, so a nominal 900ms
 * pause measured ~1400-1600ms between WORDS — squarely at the 1500ms
 * UtteranceEnd threshold, which then fired mid-utterance by design. In mulaw
 * the low-amplitude codes live at 0x70-0x7f / 0xf0-0xff; keep 60ms of edge.
 */
function trimEdgeSilence(audio: Buffer): Buffer {
  const isQuiet = (b: number) => (b & 0x70) === 0x70; // |linear| ≲ 500 of 8159
  const keep = 8 * 60; // 60ms of mulaw/8k
  let start = 0;
  while (start < audio.length && isQuiet(audio[start]!)) start++;
  let end = audio.length;
  while (end > start && isQuiet(audio[end - 1]!)) end--;
  return audio.subarray(Math.max(0, start - keep), Math.min(audio.length, end + keep));
}

/** Synthesize a caller segment once; cached across sessions. */
const segmentAudioCache = new Map<string, Buffer>();
async function callerAudio(apiKey: string, text: string): Promise<Buffer> {
  const hit = segmentAudioCache.get(text);
  if (hit) return hit;
  const chunks: Buffer[] = [];
  for await (const chunk of synthesizeAura(apiKey, CALLER_VOICE, text, new AbortController().signal)) {
    chunks.push(chunk);
  }
  const audio = trimEdgeSilence(Buffer.concat(chunks));
  segmentAudioCache.set(text, audio);
  return audio;
}

interface SessionResult {
  report: ReturnType<MetricsCollector["report"]>;
  midUtteranceReplies: number;
}

async function runSession(apiKey: string, sessionIndex: number): Promise<SessionResult> {
  const config = loadVoiceConfig();
  const context = demoCallContext();
  const metrics = new MetricsCollector();
  metrics.configEcho = { stt: config.stt, ackAfterMs: config.ackAfterMs, session: sessionIndex };
  const gateway = createVoiceGateway(metrics);
  const ackClips = await loadAckClips(apiKey, context.ttsModel, config.ackPhrases, synthesizeAura);

  // ── Agent-audio observation (the bot's judgment inputs) ──────────────────
  let agentBurstStartAt = 0;
  let agentLastAudioAt = 0;
  let agentBurstBytes = 0;
  let botMidUtterance = false;
  let bargeUtterance = false;
  let disclosureDone = false;
  let midUtteranceReplies = 0;

  const session = new CallSession({
    gateway,
    metrics,
    deepgramKey: apiKey,
    ttsModel: context.ttsModel,
    systemPrompt: context.systemPrompt,
    disclosure: context.disclosure,
    neverSay: context.neverSay,
    sttParams: config.stt,
    // DEC-091: certification exercises the PRODUCTION transport (streaming
    // Aura ws) — the cert table certifies what the deployed service runs.
    ttsTransport: config.ttsTransport,
    ackAfterMs: config.ackAfterMs,
    ackClips,
    stallAbandonMs: config.stallAbandonMs,
    idleTimeoutMs: 0, // the bot controls pacing
    maxCallMs: 0,
    sendAudio: (mulaw) => {
      const now = Date.now();
      if (now - agentLastAudioAt > 2000) {
        // A new agent burst. The judge: a REPLY starting while the bot is
        // mid-utterance — excluding the bot's own intentional barge-ins
        // (talk-over there is the bot's doing, not the agent's).
        agentBurstStartAt = now;
        agentBurstBytes = 0;
        if (disclosureDone && botMidUtterance && !bargeUtterance) {
          midUtteranceReplies += 1;
          console.error(`[cert] MID-UTTERANCE REPLY (session ${sessionIndex})`);
        }
      }
      agentLastAudioAt = now;
      agentBurstBytes += mulaw.byteLength;
    },
    clearPlayback: () => {
      agentBurstBytes = 0; // barge-in flushed the buffer
    },
  });

  const pump = new AudioPump((frame) => session.pushCallerAudio(frame));
  session.start();
  pump.start();

  /**
   * Wait until agent audio NEWER than `sinceTs` appears — the reply to the
   * bot's last utterance beginning. Without this the bot reads STALE burst
   * timestamps during the reply's LLM latency, declares "quiet", and talks
   * straight over the nascent reply (the second cert run's cascade: every
   * reply barge-aborted within ~90-400ms, sessions collapsing to 7 turns).
   */
  const waitForReplyStart = async (sinceTs: number, timeoutMs = 15_000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (agentLastAudioAt <= sinceTs) {
      if (Date.now() > deadline) {
        console.log("[cert] no reply audio within 15s — moving on");
        return false;
      }
      await sleep(50);
    }
    return true;
  };

  /**
   * Wait until the agent's current burst finished PLAYING and stayed silent
   * past the inter-sentence margin — sentence-chunked TTS legitimately gaps
   * ~1-2s between chunks while the LLM streams; only >2.5s of audio-silence
   * (past the drain estimate) is end-of-turn.
   */
  const waitForAgentQuiet = async (timeoutMs = 45_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const drainMs = (agentBurstBytes / 8000) * 1000;
      const quietAt = Math.max(agentBurstStartAt + drainMs, agentLastAudioAt + 2_500);
      if (agentLastAudioAt > 0 && Date.now() >= quietAt) return;
      if (Date.now() > deadline) return;
      await sleep(100);
    }
  };

  /** Queue one utterance (segments + adversarial pauses) into the pump and
   *  wait for its last frame to leave — ONE writer, zero overlap. */
  const speakUtterance = async (utterance: ScriptedUtterance): Promise<void> => {
    botMidUtterance = true;
    bargeUtterance = utterance.bargeIn === true;
    for (let i = 0; i < utterance.segments.length; i++) {
      const seg = utterance.segments[i]!;
      pump.enqueueSpeech(await callerAudio(apiKey, seg.text));
      if (i < utterance.segments.length - 1 && seg.pauseMs) {
        // Intra-utterance pause — silence keeps streaming (Twilio never
        // stops); this is what provokes Deepgram's endpointing.
        pump.enqueueSilence(seg.pauseMs);
      }
    }
    while (pump.pendingMs > 0) await sleep(FRAME_MS);
    botMidUtterance = false;
    bargeUtterance = false;
    // The pump feeds trailing silence on its own — endpointing + the gate
    // commit off the continuous stream.
  };

  // Let the disclosure begin and play out first.
  await waitForReplyStart(0);
  await waitForAgentQuiet();
  disclosureDone = true;

  let lastSpokeAt = 0;
  for (const utterance of DIALOGUE) {
    if (utterance.bargeIn && lastSpokeAt > 0) {
      // Real barge-in: wait for the reply to the PREVIOUS utterance to begin,
      // then start talking ~1s into it — a genuine mid-reply interrupt.
      if (await waitForReplyStart(lastSpokeAt)) await sleep(1000);
    } else if (lastSpokeAt > 0) {
      // Turn-taking: the reply begins, then finishes, then the bot speaks.
      await waitForReplyStart(lastSpokeAt);
      await waitForAgentQuiet();
    }
    lastSpokeAt = Date.now();
    await speakUtterance(utterance);
  }
  // Let the final reply land before teardown.
  await waitForReplyStart(lastSpokeAt);
  await waitForAgentQuiet();

  pump.stop();
  session.close();
  return { report: metrics.report(), midUtteranceReplies };
}

async function main(): Promise<void> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is required");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");
  const sessions = Math.max(1, Number(process.env.CERT_SESSIONS ?? 6));
  const outDir = process.env.CERT_OUT ?? "./cert";
  mkdirSync(outDir, { recursive: true });

  const results: SessionResult[] = [];
  // Top-up rule: a session lost to a provider failure keeps its turns but
  // may leave the pool short — run up to 2 extra sessions to reach ≥100
  // (logged; never silently under-sample).
  const maxSessions = sessions + 2;
  for (let i = 1; i <= maxSessions; i++) {
    const turnsSoFar = results.reduce((n, r) => n + r.report.turns, 0);
    if (i > sessions && turnsSoFar >= 100) break;
    if (i > sessions) console.log(`[cert] top-up session (${turnsSoFar}/100 turns so far)`);
    console.log(`[cert] session ${i}/${sessions}…`);
    const result = await runSession(apiKey, i);
    results.push(result);
    writeFileSync(join(outDir, `session-${i}.json`), JSON.stringify(result.report, null, 2));
    console.log(
      `[cert] session ${i}: ${result.report.turns} turns, TTFA p50=${result.report.ttfaMs.p50}ms, ` +
        `dropped=${result.report.droppedAudio.length}, midUtterance=${result.midUtteranceReplies}`,
    );
  }

  // ── Aggregate: the promote-gate table — percentiles pooled over ALL turns ─
  const allTtfa = results.flatMap((r) => r.report.ttfaSamplesMs);
  const totalTurns = results.reduce((n, r) => n + r.report.turns, 0);
  const totalDropped = results.reduce((n, r) => n + r.report.droppedAudio.length, 0);
  const totalMidUtterance = results.reduce((n, r) => n + r.midUtteranceReplies, 0);
  const totalBargeIns = results.reduce((n, r) => n + r.report.bargeIns.length, 0);
  const totalStalled = results.reduce((n, r) => n + r.report.stalledTurns, 0);
  const costPerMin = results.map((r) => r.report.cost.perMinuteUsd);
  const ackRates = results.map((r) => r.report.ackRate);

  const ttfaP50 = percentile(allTtfa, 50);
  const ttfaP95 = percentile(allTtfa, 95);
  const ackRateMean = ackRates.reduce((a, b) => a + b, 0) / ackRates.length;
  // Owner-ruled amendments (2026-07-15, after the 7-run falsification trail):
  // - DEC-089: p95 ≤ 2000ms — the 1729-1958ms band is a stable VENDOR
  //   first-token tail, with the ack clip pinned as an INVARIANT (≥95% of
  //   turns masked) so the caller never hears the tail as silence.
  // - DEC-088: mid-utterance residual ≤7% of turns — the remaining 4-7/~110
  //   is STT-layer (missed resumed-fragment words), bounded sub-second by the
  //   proven VAD barge-in; a scheduled cert run monitors the ceiling.
  const midUtteranceRate = totalTurns > 0 ? totalMidUtterance / totalTurns : 0;
  const gate = {
    turns: totalTurns,
    turnsGateMet: totalTurns >= 100,
    ttfaP50Ms: ttfaP50,
    ttfaP50Met: ttfaP50 <= 1200,
    ttfaP95Ms: ttfaP95,
    ttfaP95Met: ttfaP95 <= 2000,
    ttfaGateMet: ttfaP50 <= 1200 && ttfaP95 <= 2000,
    ackRateMean,
    ackMaskGateMet: ackRateMean >= 0.95,
    droppedAudio: totalDropped,
    droppedGateMet: totalDropped === 0,
    midUtteranceReplies: totalMidUtterance,
    midUtteranceRate,
    midUtteranceGateMet: midUtteranceRate <= 0.07,
    bargeIns: totalBargeIns,
    stalledTurns: totalStalled,
    costPerMinuteUsdMean: costPerMin.reduce((a, b) => a + b, 0) / costPerMin.length,
    config: results[0]?.report.config ?? {},
    sessions: results.map((r, i) => ({
      session: i + 1,
      turns: r.report.turns,
      ttfa: r.report.ttfaMs,
      roundTrip: r.report.roundTripMs,
      dropped: r.report.droppedAudio.length,
      midUtterance: r.midUtteranceReplies,
      bargeIns: r.report.bargeIns.length,
      ackRate: r.report.ackRate,
      commitSources: r.report.commitSources,
      costPerMinuteUsd: r.report.cost.perMinuteUsd,
    })),
  };
  const pass =
    gate.turnsGateMet &&
    gate.ttfaGateMet &&
    gate.ackMaskGateMet &&
    gate.droppedGateMet &&
    gate.midUtteranceGateMet;

  writeFileSync(join(outDir, "cert-table.json"), JSON.stringify({ pass, ...gate }, null, 2));
  const md = [
    `# P3.1 certification — ${pass ? "PASS" : "FAIL"} (amended gate: DEC-089/DEC-088)`,
    "",
    "| Gate | Required | Measured | Met |",
    "|---|---|---|---|",
    `| Turns | ≥100 | ${gate.turns} | ${gate.turnsGateMet ? "✅" : "❌"} |`,
    `| TTFA p50 (all turns pooled) | ≤ 1200ms | ${gate.ttfaP50Ms}ms | ${gate.ttfaP50Met ? "✅" : "❌"} |`,
    `| TTFA p95 (all turns pooled) | ≤ 2000ms (DEC-089) | ${gate.ttfaP95Ms}ms | ${gate.ttfaP95Met ? "✅" : "❌"} |`,
    `| Ack-mask invariant | ≥95% of turns (DEC-089) | ${(gate.ackRateMean * 100).toFixed(0)}% | ${gate.ackMaskGateMet ? "✅" : "❌"} |`,
    `| Dropped audio | 0 | ${gate.droppedAudio} | ${gate.droppedGateMet ? "✅" : "❌"} |`,
    `| Mid-utterance replies | ≤7% of turns (DEC-088) | ${gate.midUtteranceReplies} (${(gate.midUtteranceRate * 100).toFixed(1)}%) | ${gate.midUtteranceGateMet ? "✅" : "❌"} |`,
    "",
    `Barge-ins exercised: ${gate.bargeIns} · stalled turns yielded: ${gate.stalledTurns} · ack rate: ${(gate.ackRateMean * 100).toFixed(0)}% · est. cost/min: $${gate.costPerMinuteUsdMean.toFixed(3)}`,
    "",
    "Config: " + "`" + JSON.stringify(gate.config) + "`",
  ].join("\n");
  writeFileSync(join(outDir, "cert-table.md"), md);
  console.log(md);
  if (!pass) process.exitCode = 1;
}

void main().catch((err) => {
  console.error("[cert] failed:", (err as Error).message);
  process.exitCode = 1;
});

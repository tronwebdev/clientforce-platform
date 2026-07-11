/**
 * The voice "brain": the gateway's streaming voice route plus a sentence
 * chunker so TTS can start on the first complete sentence instead of waiting
 * for the whole reply (the main time-to-first-audio lever).
 */
import { AiGateway, AnthropicProvider, type VoiceTurn } from "@clientforce/ai";
import type { MetricsCollector } from "./metrics";

export const SYSTEM_PROMPT = [
  "You are a friendly phone assistant for Clientforce, calling on behalf of a demo business.",
  "You are in a LIVE PHONE CALL — replies are spoken aloud by TTS.",
  "Rules: at most two short sentences per reply; plain conversational words;",
  "no lists, no markdown, no emoji; never read out URLs or spell things unless asked.",
  "Goal: ask what the caller is working on, gauge interest in a product demo,",
  "and offer to book a 20-minute call. If they decline, thank them and wrap up.",
].join(" ");

/** Buffers streamed deltas and flushes speakable chunks at sentence ends. */
export class SentenceChunker {
  private buffer = "";

  /** Feed a delta; returns any complete sentences ready for TTS. */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    // Split on sentence enders followed by whitespace; keep the ender.
    for (;;) {
      const match = /[.!?…]["')\]]?\s/.exec(this.buffer);
      if (!match) break;
      const end = match.index + match[0].length;
      const sentence = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end);
      if (sentence) out.push(sentence);
    }
    // Long clause without an ender: flush at a comma past 80 chars so TTS
    // never sits on a run-on sentence.
    if (this.buffer.length > 80) {
      const comma = this.buffer.lastIndexOf(", ");
      if (comma > 40) {
        out.push(this.buffer.slice(0, comma + 1).trim());
        this.buffer = this.buffer.slice(comma + 2);
      }
    }
    return out;
  }

  /** Whatever's left when the stream ends. */
  flush(): string | undefined {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest.length > 0 ? rest : undefined;
  }
}

export function createVoiceGateway(metrics: MetricsCollector): AiGateway {
  return new AiGateway({
    provider: new AnthropicProvider(),
    onUsage: (r) => {
      metrics.llmCostUsd += r.estimatedCostUsd;
      console.log(
        `[ai] task=${r.task} model=${r.model} in=${r.usage.inputTokens} out=${r.usage.outputTokens} latencyMs=${r.latencyMs} outcome=${r.outcome}`,
      );
    },
  });
}

export type { VoiceTurn };

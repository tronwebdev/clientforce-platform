/**
 * Acknowledgment clips (P3.1) — the latency-masking lever. Short constant
 * phrases pre-rendered ONCE per (voice, phrase) per process and replayed as
 * raw mulaw buffers, so the ack itself costs zero latency and zero per-turn
 * TTS spend. Constants, never composed — same discipline as the disclosure.
 */
import type { Synthesize } from "./deepgram";

const cache = new Map<string, Buffer[]>();

/**
 * Pre-render the ack phrases for a voice. Failures degrade gracefully to NO
 * masking (empty array) — an ack is an enhancement, never worth failing a
 * call over.
 */
export async function loadAckClips(
  apiKey: string,
  ttsModel: string,
  phrases: readonly string[],
  synthesize: Synthesize,
): Promise<Buffer[]> {
  const key = `${ttsModel}:${phrases.join("|")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const clips: Buffer[] = [];
  for (const phrase of phrases) {
    try {
      const chunks: Buffer[] = [];
      const abort = new AbortController();
      for await (const chunk of synthesize(apiKey, ttsModel, phrase, abort.signal)) {
        chunks.push(chunk);
      }
      if (chunks.length > 0) clips.push(Buffer.concat(chunks));
    } catch (err) {
      console.error(`[ack] pre-render failed for "${phrase}":`, (err as Error).message);
    }
  }
  cache.set(key, clips);
  return clips;
}

/** Tests only. */
export const clearAckCache = (): void => cache.clear();

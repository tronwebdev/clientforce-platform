/**
 * Deepgram clients — raw WebSocket for streaming STT, raw fetch for Aura TTS.
 * No SDK: the spike needs precise control over timing and both APIs speak
 * mulaw/8k natively, so Twilio audio passes through untranscoded either way.
 */
import WebSocket from "ws";

export interface SttEvents {
  /** VAD onset — the barge-in trigger while the agent is speaking. */
  onSpeechStarted: () => void;
  /** A final transcript fragment (is_final=true). */
  onFinal: (text: string, speechFinal: boolean) => void;
  /** Deepgram's endpointing gave up waiting for more speech. */
  onUtteranceEnd: () => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

export interface SttStream {
  sendAudio: (mulaw: Buffer) => void;
  close: () => void;
}

interface DeepgramResult {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string }> };
}

const STT_URL =
  "wss://api.deepgram.com/v1/listen?model=nova-2&encoding=mulaw&sample_rate=8000&channels=1" +
  "&interim_results=true&vad_events=true&endpointing=300&utterance_end_ms=1200&punctuate=true";

export function openSttStream(apiKey: string, events: SttEvents): SttStream {
  const ws = new WebSocket(STT_URL, { headers: { Authorization: `Token ${apiKey}` } });
  const pending: Buffer[] = [];
  let open = false;

  ws.on("open", () => {
    open = true;
    for (const buf of pending.splice(0)) ws.send(buf);
  });
  ws.on("message", (data) => {
    let msg: DeepgramResult;
    try {
      msg = JSON.parse(String(data)) as DeepgramResult;
    } catch {
      return;
    }
    if (msg.type === "SpeechStarted") {
      events.onSpeechStarted();
    } else if (msg.type === "UtteranceEnd") {
      events.onUtteranceEnd();
    } else if (msg.type === "Results" && msg.is_final) {
      const text = msg.channel?.alternatives?.[0]?.transcript ?? "";
      events.onFinal(text, msg.speech_final === true);
    }
  });
  ws.on("error", (err) => events.onError(err instanceof Error ? err : new Error(String(err))));
  ws.on("close", () => events.onClose());

  return {
    sendAudio: (mulaw) => {
      if (open && ws.readyState === WebSocket.OPEN) ws.send(mulaw);
      else pending.push(mulaw);
    },
    close: () => {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
        ws.close();
      } catch {
        // teardown only
      }
    },
  };
}

const TTS_URL =
  "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mulaw&sample_rate=8000&container=none";

/**
 * Streams Aura TTS audio for `text` as raw mulaw/8k chunks. Aborting `signal`
 * cancels generation mid-stream (barge-in).
 */
export async function* synthesizeAura(
  apiKey: string,
  text: string,
  signal: AbortSignal,
): AsyncGenerator<Buffer> {
  const res = await fetch(TTS_URL, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Aura TTS failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) yield Buffer.from(value);
    }
  } finally {
    reader.releaseLock();
  }
}
